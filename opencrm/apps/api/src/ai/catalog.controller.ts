import { Controller, Get } from "@nestjs/common";
import { AiService } from "./ai.service";
import { DESIGN_SYSTEMS, DESIGN_TEMPLATES } from "@opencrm/shared";

@Controller("catalog")
export class CatalogController {
  constructor(private svc: AiService) {}

  // Public lists — static curated data, no auth needed
  @Get("design-systems")
  listDesignSystems() {
    return Object.entries(DESIGN_SYSTEMS).map(([id, s]) => ({ id, name: s.name, description: s.description }));
  }

  @Get("design-templates")
  listDesignTemplates() {
    return DESIGN_TEMPLATES.map((t) => ({ id: t.id, name: t.name, description: t.description, mode: t.mode }));
  }

  @Get("health")
  health() {
    return { ok: true, time: Date.now(), count: { systems: Object.keys(DESIGN_SYSTEMS).length, templates: DESIGN_TEMPLATES.length } };
  }
}