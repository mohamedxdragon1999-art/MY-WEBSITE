import { Module } from "@nestjs/common";
import { AiService } from "./ai.service";
import { AiController } from "./ai.controller";
import { CatalogController } from "./catalog.controller";
import { ProviderPoolService } from "./provider-pool";

@Module({
  providers: [AiService, ProviderPoolService],
  controllers: [AiController, CatalogController],
})
export class AiModule {}
