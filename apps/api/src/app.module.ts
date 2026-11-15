import { ReadinessController } from "./readiness.controller";
import { Module } from "@nestjs/common";
import { PilotModule } from "./pilot/pilot.module";
import { HealthController } from "./health.controller";
@Module({
  imports: [PilotModule],
  controllers: [HealthController, ReadinessController],
})
export class AppModule {}
