const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const { MongoClient, ObjectId } = require("mongodb");
require("dotenv").config();

const app = express();
const port = process.env.PORT || 5000;
const mongoUri = process.env.MONGODB_URI;
const dbName = process.env.DB_NAME || "studynook";
const jwtSecret = process.env.JWT_SECRET || "studynook_dev_secret_change_me";
const allowedOrigins = (process.env.CLIENT_URL || "http://localhost:5173")
  .split(",")
  .map((origin) => origin.trim());
const isDevelopment = process.env.NODE_ENV !== "production";

let db;
let usersCollection;
let roomsCollection;
let bookingsCollection;
// db.collection('users').createIndex({ email: 1 }, { unique: true });

const corsOptions = {
  origin(origin, callback) {
    if (!origin) {
      callback(null, true);
      return;
    }
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
      return;
    }
    if (isDevelopment && origin.startsWith("http://localhost")) {
      callback(null, true);
      return;
    }
    callback(new Error("Not allowed by CORS"));
  },
  credentials: true,
};

app.use(cors(corsOptions));
app.use(express.json());
app.use(cookieParser());

const getCookieOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: process.env.COOKIE_SAMESITE || "lax",
  maxAge: 7 * 24 * 60 * 60 * 1000,
});
// implemeted jwt token creation, auth 
const createToken = (userId) => {
  return jwt.sign({ userId }, jwtSecret, { expiresIn: "7d" });
};

const authMiddleware = (req, res, next) => {
  const token = req.cookies.token;

  if (!token) {
    res.status(401).send({ message: "Unauthorized access" });
    return;
  }

  try {
    const decoded = jwt.verify(token, jwtSecret);
    req.user = { id: decoded.userId };
    next();
  } catch (error) {
    res.status(401).send({ message: "Invalid or expired token" });
  }
};

const getUserById = async (id) => {
  if (!ObjectId.isValid(id)) {
    return null;
  }

  return usersCollection.findOne(
    { _id: new ObjectId(id) },
    { projection: { password: 0 } }
  );
};

const isFutureOrToday = (dateText) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const selectedDate = new Date(`${dateText}T00:00:00`);
  return selectedDate >= today;
};

const buildPublicRoom = (room) => ({
  ...room,
  _id: room._id.toString(),
});

async function run() {
  if (!mongoUri) {
    throw new Error("MONGODB_URI is missing in .env");
  }

  const client = new MongoClient(mongoUri);
  await client.connect();
  db = client.db(dbName);
  usersCollection = db.collection("users");
  roomsCollection = db.collection("rooms");
  bookingsCollection = db.collection("bookings");

  await usersCollection.createIndex({ email: 1 }, { unique: true });
  await roomsCollection.createIndex({ roomName: "text" });
  await bookingsCollection.createIndex({
    roomId: 1,
    date: 1,
    status: 1,
    startTime: 1,
    endTime: 1,
  });

  app.get("/", (req, res) => {
    res.send({
      message: "StudyNook server is running",
      routes: ["/api/rooms", "/api/rooms/latest", "/api/auth/me"],
    });
  });

  app.post("/api/auth/register", async (req, res) => {
    const { name, email, photo, password } = req.body;

    if (!name || !email || !password) {
      res.status(400).send({ message: "Name, email, and password are required" });
      return;
    }

    const existingUser = await usersCollection.findOne({ email });
    if (existingUser) {
      res.status(409).send({ message: "User already exists" });
      return;
    }

    const defaultPhoto = `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=3b82f6&color=ffffff`;
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = {
      name,
      email,
      photo: photo || defaultPhoto,
      password: hashedPassword,
      provider: "email",
      bookings: [],
      createdAt: new Date(),
    };

    const result = await usersCollection.insertOne(user);
    res.status(201).send({ insertedId: result.insertedId });
  });

  app.post("/api/auth/login", async (req, res) => {
    const { email, password } = req.body;
    const user = await usersCollection.findOne({ email });

    if (!user || !user.password) {
      res.status(401).send({ message: "Invalid email or password" });
      return;
    }

    const isPasswordOk = await bcrypt.compare(password, user.password);
    if (!isPasswordOk) {
      res.status(401).send({ message: "Invalid email or password" });
      return;
    }

    const token = createToken(user._id.toString());
    res.cookie("token", token, getCookieOptions());
    res.send({
      user: {
        _id: user._id.toString(),
        name: user.name,
        email: user.email,
        photo: user.photo,
      },
    });
  });

  app.post("/api/auth/google", async (req, res) => {
    const { name, email, photo } = req.body;

    if (!name || !email || !photo) {
      res.status(400).send({ message: "Google profile data is required" });
      return;
    }

    const existingUser = await usersCollection.findOne({ email });
    let userId = existingUser?._id;

    if (!existingUser) {
      const result = await usersCollection.insertOne({
        name,
        email,
        photo,
        provider: "google",
        bookings: [],
        createdAt: new Date(),
      });
      userId = result.insertedId;
    } else {
      await usersCollection.updateOne(
        { _id: existingUser._id },
        { $set: { name, photo, provider: existingUser.provider || "google" } }
      );
    }

    const token = createToken(userId.toString());
    res.cookie("token", token, getCookieOptions());
    res.send({
      user: {
        _id: userId.toString(),
        name,
        email,
        photo,
      },
    });
  });

  app.post("/api/auth/logout", (req, res) => {
    res.clearCookie("token", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: process.env.COOKIE_SAMESITE || "lax",
    });
    res.send({ message: "Logged out successfully" });
  });

  app.get("/api/auth/me", authMiddleware, async (req, res) => {
    const user = await getUserById(req.user.id);

    if (!user) {
      res.status(404).send({ message: "User not found" });
      return;
    }

    res.send({ ...user, _id: user._id.toString() });
  });

  app.get("/api/rooms/latest", async (req, res) => {
    const rooms = await roomsCollection
      .find({})
      .sort({ createdAt: -1 })
      .limit(6)
      .toArray();

    res.send(rooms.map(buildPublicRoom));
  });

  app.get("/api/rooms", async (req, res) => {
    const { search, amenities, minRate, maxRate, floor } = req.query;
    const query = {};

    if (search) {
      query.roomName = { $regex: search, $options: "i" };
    }

    if (amenities) {
      const selectedAmenities = amenities.split(",").filter(Boolean);
      if (selectedAmenities.length) {
        query.amenities = { $in: selectedAmenities };
      }
    }

    if (floor) {
      query.floor = { $regex: floor, $options: "i" };
    }

    if (minRate || maxRate) {
      query.hourlyRate = {};
      if (minRate) {
        query.hourlyRate.$gte = Number(minRate);
      }
      if (maxRate) {
        query.hourlyRate.$lte = Number(maxRate);
      }
    }

    const rooms = await roomsCollection.find(query).sort({ createdAt: -1 }).toArray();
    res.send(rooms.map(buildPublicRoom));
  });

  app.post("/api/rooms", authMiddleware, async (req, res) => {
    const { roomName, description, image, floor, capacity, hourlyRate, amenities } = req.body;
    const owner = await getUserById(req.user.id);

    if (!owner) {
      res.status(401).send({ message: "Owner account not found" });
      return;
    }

    if (!roomName || !description || !image || !floor || !capacity || !hourlyRate) {
      res.status(400).send({ message: "Required room fields are missing" });
      return;
    }

    const newRoom = {
      roomName,
      description,
      image,
      floor,
      capacity: Number(capacity),
      hourlyRate: Number(hourlyRate),
      amenities: Array.isArray(amenities) ? amenities : [],
      ownerId: owner._id.toString(),
      ownerEmail: owner.email,
      ownerName: owner.name,
      bookingCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await roomsCollection.insertOne(newRoom);
    res.status(201).send({ insertedId: result.insertedId });
  });

  app.get("/api/rooms/:id", async (req, res) => {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      res.status(400).send({ message: "Invalid room id" });
      return;
    }

    const room = await roomsCollection.findOne({ _id: new ObjectId(id) });
    if (!room) {
      res.status(404).send({ message: "Room not found" });
      return;
    }

    res.send(buildPublicRoom(room));
  });

  app.patch("/api/rooms/:id", authMiddleware, async (req, res) => {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      res.status(400).send({ message: "Invalid room id" });
      return;
    }

    const room = await roomsCollection.findOne({ _id: new ObjectId(id) });
    if (!room) {
      res.status(404).send({ message: "Room not found" });
      return;
    }

    if (room.ownerId !== req.user.id) {
      res.status(403).send({ message: "Only the owner can update this room" });
      return;
    }

    const allowedFields = [
      "roomName",
      "description",
      "image",
      "floor",
      "capacity",
      "hourlyRate",
      "amenities",
    ];
    const updatedRoom = {};

    allowedFields.forEach((field) => {
      if (req.body[field] !== undefined) {
        updatedRoom[field] = req.body[field];
      }
    });

    if (updatedRoom.capacity !== undefined) {
      updatedRoom.capacity = Number(updatedRoom.capacity);
    }
    if (updatedRoom.hourlyRate !== undefined) {
      updatedRoom.hourlyRate = Number(updatedRoom.hourlyRate);
    }
    if (updatedRoom.amenities && !Array.isArray(updatedRoom.amenities)) {
      updatedRoom.amenities = [];
    }

    updatedRoom.updatedAt = new Date();

    const result = await roomsCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: updatedRoom }
    );

    res.send(result);
  });

  app.delete("/api/rooms/:id", authMiddleware, async (req, res) => {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      res.status(400).send({ message: "Invalid room id" });
      return;
    }

    const room = await roomsCollection.findOne({ _id: new ObjectId(id) });
    if (!room) {
      res.status(404).send({ message: "Room not found" });
      return;
    }

    if (room.ownerId !== req.user.id) {
      res.status(403).send({ message: "Only the owner can delete this room" });
      return;
    }

    const roomBookings = await bookingsCollection.find({ roomId: id }).toArray();
    const bookingIds = roomBookings.map((booking) => booking._id.toString());

    if (bookingIds.length) {
      await usersCollection.updateMany({}, { $pull: { bookings: { $in: bookingIds } } });
      await bookingsCollection.updateMany(
        { roomId: id },
        { $set: { status: "cancelled", roomDeleted: true } }
      );
    }

    const result = await roomsCollection.deleteOne({ _id: new ObjectId(id) });
    res.send(result);
  });

  app.get("/api/my-listings", authMiddleware, async (req, res) => {
    const rooms = await roomsCollection
      .find({ ownerId: req.user.id })
      .sort({ createdAt: -1 })
      .toArray();

    res.send(rooms.map(buildPublicRoom));
  });

  app.post("/api/bookings", authMiddleware, async (req, res) => {
    const { roomId, date, startTime, endTime, totalCost, specialNote } = req.body;

    if (!roomId || !date || !startTime || !endTime) {
      res.status(400).send({ message: "Booking date and time are required" });
      return;
    }

    if (!ObjectId.isValid(roomId)) {
      res.status(400).send({ message: "Invalid room id" });
      return;
    }

    if (!isFutureOrToday(date)) {
      res.status(400).send({ message: "Booking date must be today or future" });
      return;
    }

    if (startTime >= endTime) {
      res.status(400).send({ message: "End time must be after start time" });
      return;
    }

    const room = await roomsCollection.findOne({ _id: new ObjectId(roomId) });
    const user = await getUserById(req.user.id);

    if (!room || !user) {
      res.status(404).send({ message: "Room or user not found" });
      return;
    }

    const conflict = await bookingsCollection.findOne({
      roomId,
      date,
      status: "confirmed",
      $or: [
        { startTime: { $gte: startTime, $lt: endTime } },
        { endTime: { $gt: startTime, $lte: endTime } },
        { startTime: { $lte: startTime }, endTime: { $gte: endTime } },
      ],
    });

    if (conflict) {
      res.status(409).send({ message: "This time slot is already booked" });
      return;
    }

    const booking = {
      roomId,
      userId: req.user.id,
      userEmail: user.email,
      date,
      startTime,
      endTime,
      totalCost: Number(totalCost),
      specialNote: specialNote || "",
      status: "confirmed",
      createdAt: new Date(),
    };

    const result = await bookingsCollection.insertOne(booking);
    await usersCollection.updateOne(
      { _id: new ObjectId(req.user.id) },
      { $push: { bookings: result.insertedId.toString() } }
    );
    await roomsCollection.updateOne(
      { _id: new ObjectId(roomId) },
      { $inc: { bookingCount: 1 } }
    );

    res.status(201).send({ insertedId: result.insertedId });
  });

  app.get("/api/bookings/my-bookings", authMiddleware, async (req, res) => {
    const bookings = await bookingsCollection
      .find({ userId: req.user.id })
      .sort({ createdAt: -1 })
      .toArray();

    const roomObjectIds = bookings
      .filter((booking) => ObjectId.isValid(booking.roomId))
      .map((booking) => new ObjectId(booking.roomId));
    const rooms = await roomsCollection.find({ _id: { $in: roomObjectIds } }).toArray();
    const roomMap = {};

    rooms.forEach((room) => {
      roomMap[room._id.toString()] = buildPublicRoom(room);
    });

    const populatedBookings = bookings.map((booking) => ({
      ...booking,
      _id: booking._id.toString(),
      room: roomMap[booking.roomId] || null,
    }));

    res.send(populatedBookings);
  });

  app.patch("/api/bookings/:id/cancel", authMiddleware, async (req, res) => {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      res.status(400).send({ message: "Invalid booking id" });
      return;
    }

    const booking = await bookingsCollection.findOne({ _id: new ObjectId(id) });
    if (!booking) {
      res.status(404).send({ message: "Booking not found" });
      return;
    }

    if (booking.userId !== req.user.id) {
      res.status(403).send({ message: "You can cancel only your own booking" });
      return;
    }

    if (booking.status !== "confirmed") {
      res.status(400).send({ message: "Only confirmed bookings can be cancelled" });
      return;
    }

    if (!isFutureOrToday(booking.date)) {
      res.status(400).send({ message: "Past bookings cannot be cancelled" });
      return;
    }

    const result = await bookingsCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: { status: "cancelled", cancelledAt: new Date() } }
    );

    await usersCollection.updateOne(
      { _id: new ObjectId(req.user.id) },
      { $pull: { bookings: id } }
    );
    await roomsCollection.updateOne(
      { _id: new ObjectId(booking.roomId) },
      { $inc: { bookingCount: -1 } }
    );

    res.send(result);
  });

  app.use((req, res) => {
    res.status(404).send({ message: "API route not found" });
  });

  app.listen(port, () => {
    console.log(`StudyNook server running on port ${port}`);
  });
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});



