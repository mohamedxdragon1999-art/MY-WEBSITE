import { Module } from "@nestjs/common";
import { FunnelsService } from "./funnels.service";
import { FunnelsController } from "./funnels.controller";
import { PublicFormsController } from "./public-forms.controller";

@Module({ providers: [FunnelsService], controllers: [FunnelsController, PublicFormsController] })
export class FunnelsModule {}
