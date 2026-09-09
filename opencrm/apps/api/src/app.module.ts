import { Module } from "@nestjs/common";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { APP_GUARD } from "@nestjs/core";
import { PrismaModule } from "./prisma/prisma.module";
import { AuthModule } from "./auth/auth.module";
import { ContactsModule } from "./contacts/contacts.module";
import { FunnelsModule } from "./funnels/funnels.module";
import { AiModule } from "./ai/ai.module";
import { UploadsModule } from "./uploads/uploads.module";

@Module({
  imports: [
    // NOTE: @nestjs/throttler counts PER ROUTE (key = handler + ip). So forRoot holds ONE
    // generous per-route default; strict budgets are set per-route via @Throttle({default:{...}}).
    // (Wave 4 lesson: named throttlers in forRoot applied to EVERY route and 429'd legit
    // bulk editing — 22 doc saves tripped the 15/min 'ai' bucket.)
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    PrismaModule,
    AuthModule,
    ContactsModule,
    FunnelsModule,
    AiModule,
    UploadsModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
