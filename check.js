const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function check() {
  const inventory = await prisma.inventory.findFirst({
    where: { product: { barcode: "123456" } }
  });
  console.log("Current quantity:", inventory.current_quantity);
  
  const logs = await prisma.stockLog.findMany({
    where: { product: { barcode: "123456" } }
  });
  console.log("Stock logs:", JSON.stringify(logs, null, 2));
}

check().then(() => prisma.$disconnect());