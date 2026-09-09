import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class ContactsService {
  constructor(private prisma: PrismaService) {}

  async list(subAccountId: string, opts?: { q?: string; skip?: number; take?: number; envelope?: boolean }) {
    const take = Math.min(100, Math.max(1, opts?.take ?? 100));
    const skip = Math.max(0, opts?.skip ?? 0);
    const q = opts?.q?.trim();
    const where = {
      subAccountId,
      ...(q
        ? {
            OR: [
              { email: { contains: q } },
              { phone: { contains: q } },
              { firstName: { contains: q } },
              { lastName: { contains: q } },
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.contact.findMany({ where, orderBy: { updatedAt: "desc" }, take, skip }),
      opts?.envelope ? this.prisma.contact.count({ where }) : Promise.resolve(-1),
    ]);
    // Default stays a bare array (frontend-compatible); ?envelope=1 opts into metadata.
    if (opts?.envelope) return { items, total, skip, take };
    return items;
  }

  create(subAccountId: string, data: { email?: string; phone?: string; firstName?: string; lastName?: string }) {
    const email = data.email?.trim() || undefined;
    const phone = data.phone?.trim() || undefined;
    const firstName = data.firstName?.trim() || undefined;
    const lastName = data.lastName?.trim() || undefined;
    if (!email && !phone && !firstName && !lastName) {
      throw new BadRequestException("Provide at least one of: email, phone, firstName, lastName");
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new BadRequestException("Invalid email");
    return this.prisma.contact.create({ data: { email, phone, firstName, lastName, subAccountId } });
  }

  async remove(subAccountId: string, id: string) {
    if (!id || typeof id !== "string") throw new BadRequestException("Invalid id");
    const res = await this.prisma.contact.deleteMany({ where: { id, subAccountId } });
    if (res.count === 0) throw new NotFoundException("Contact not found");
    return { ok: true, deleted: res.count };
  }

  async update(subAccountId: string, id: string, data: { email?: string; phone?: string; firstName?: string; lastName?: string }) {
    if (!id || typeof id !== "string") throw new BadRequestException("Invalid id");
    const patch: Record<string, string> = {};
    for (const k of ["email", "phone", "firstName", "lastName"] as const) {
      const v = data[k]?.trim();
      if (v) patch[k] = k === "email" ? v.toLowerCase() : v;
    }
    if (Object.keys(patch).length === 0) throw new BadRequestException("Provide at least one field to update");
    if (patch.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(patch.email)) throw new BadRequestException("Invalid email");
    const existing = await this.prisma.contact.findFirst({ where: { id, subAccountId } });
    if (!existing) throw new NotFoundException("Contact not found");
    return this.prisma.contact.update({ where: { id }, data: patch });
  }
}
