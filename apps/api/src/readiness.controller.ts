import {
  Controller,
  Get,
  Header,
  Inject,
  ServiceUnavailableException,
} from "@nestjs/common";
import { PILOT_RUNTIME, type PilotRuntime } from "./pilot/contracts";
@Controller("ready")
export class ReadinessController {
  constructor(
    @Inject(PILOT_RUNTIME) private readonly runtime: PilotRuntime | null,
  ) {}
  @Get()
  @Header("Cache-Control", "no-store")
  @Header("Pragma", "no-cache")
  async status() {
    try {
      if (await this.runtime?.readiness()) return { status: "ready" };
    } catch {
      /* Dependency diagnostics must not enter the public response. */
    }
    throw new ServiceUnavailableException({ status: "not-ready" });
  }
}
