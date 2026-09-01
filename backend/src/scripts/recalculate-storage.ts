import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
for (const user of await prisma.user.findMany({ select: { id: true } })) {
  const total = await prisma.file.aggregate({ where: { userId: user.id }, _sum: { size: true } });
  await prisma.user.update({ where: { id: user.id }, data: { storageUsed: total._sum.size ?? 0n } });
}
await prisma.$disconnect();
console.log("Storage counters recalculated.");
