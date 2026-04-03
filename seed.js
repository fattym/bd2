const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function seed() {
  // 1. Create Users
  const user1 = await prisma.user.create({
    data: {
      name: "Alice Shop",
      email: "alice@example.com",
      password: "password123",
      region: "CBD",
      latitude: -1.286389,
      longitude: 36.817223 // Nairobi
    }
  });

  const user2 = await prisma.user.create({
    data: {
      name: "Bob's Store",
      email: "bob@example.com",
      password: "password123",
      region: "Kilimani",
      latitude: -1.303264,
      longitude: 36.782352 // Kilimani area
    }
  });

  // 2. Create Products for Alice
  await prisma.product.create({
    data: {
      barcode: "1001",
      name: "Alice's Item A",
      user_id: user1.id,
      inventory: {
        create: {
          user_id: user1.id,
          current_quantity: 50
        }
      }
    }
  });

  // 3. Create Products for Bob (same barcode as Alice to test multi-tenancy)
  await prisma.product.create({
    data: {
      barcode: "1001",
      name: "Bob's Item A",
      user_id: user2.id,
      inventory: {
        create: {
          user_id: user2.id,
          current_quantity: 20
        }
      }
    }
  });

  await prisma.product.create({
    data: {
      barcode: "2002",
      name: "Bob's Unique Item",
      user_id: user2.id,
      inventory: {
        create: {
          user_id: user2.id,
          current_quantity: 100
        }
      }
    }
  });

  console.log("Seeding completed successfully");
}

seed()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });