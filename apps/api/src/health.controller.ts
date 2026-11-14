import { Controller, Get } from "@nestjs/common";
@Controller("health")
export class HealthController {
  @Get()
  status(): { status: string; db: string; auth: string } {
    return { status: "ok", db: "not-checked", auth: "not-checked" };
  }
}
