const { MongoClient } = require('mongodb');
require('dotenv').config();

;(async () => {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI not set in .env');
    process.exit(1);
  }

  const client = new MongoClient(uri);
  try {
    await client.connect();
    const db = client.db(process.env.DB_NAME || 'studynook');
    const rooms = db.collection('rooms');

    const count = await rooms.countDocuments();
    if (count > 0) {
      console.log('Rooms collection already has data — skipping seeding.');
      return;
    }

    const sample = [
      {
        roomName: 'North Wing Focus Room',
        description: 'Quiet individual study room with desk and lamp.',
        image: 'https://images.unsplash.com/photo-1524758631624-e2822e304c36?q=80&w=1200&auto=format&fit=crop',
        floor: '1',
        capacity: 1,
        hourlyRate: 5,
        amenities: ['Wi-Fi', 'Whiteboard'],
        ownerId: 'system',
        ownerEmail: 'system@studynook.local',
        ownerName: 'StudyNook',
        bookingCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        roomName: 'Media Lab 410',
        description: 'Spacious room with projector and seating for group study.',
        image: 'https://images.unsplash.com/photo-1507679799987-c73779587ccf?q=80&w=1200&auto=format&fit=crop',
        floor: '4',
        capacity: 8,
        hourlyRate: 20,
        amenities: ['Projector', 'Power Outlets', 'Wi-Fi'],
        ownerId: 'system',
        ownerEmail: 'system@studynook.local',
        ownerName: 'StudyNook',
        bookingCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        roomName: 'Archive Suite 2B',
        description: 'Private suite for small teams with whiteboard and AC.',
        image: 'https://images.unsplash.com/photo-1557804506-669a67965ba0?q=80&w=1200&auto=format&fit=crop',
        floor: '2',
        capacity: 4,
        hourlyRate: 12,
        amenities: ['Whiteboard', 'Air Conditioning', 'Wi-Fi'],
        ownerId: 'system',
        ownerEmail: 'system@studynook.local',
        ownerName: 'StudyNook',
        bookingCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      }
    ];

    const result = await rooms.insertMany(sample);
    console.log('Inserted sample rooms:', result.insertedCount);
  } catch (err) {
    console.error('Seeding failed:', err);
    process.exit(1);
  } finally {
    await client.close();
  }
})();
