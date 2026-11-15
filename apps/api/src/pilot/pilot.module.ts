import { pilotNoCache } from "./no-cache.middleware";
import {
  Inject,
  Module,
  type MiddlewareConsumer,
  type NestModule,
  type OnModuleDestroy,
} from "@nestjs/common";
import { PILOT_RUNTIME, type PilotRuntime } from "./contracts";
import { PilotController } from "./pilot.controller";
import { createPilotRuntime } from "./runtime";
@Module({
  controllers: [PilotController],
  exports: [PILOT_RUNTIME],
  providers: [
    { provide: PILOT_RUNTIME, useFactory: () => createPilotRuntime() },
  ],
})
export class PilotModule implements OnModuleDestroy, NestModule {
  constructor(
    @Inject(PILOT_RUNTIME) private readonly runtime: PilotRuntime | null,
  ) {}
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(pilotNoCache).forRoutes(PilotController);
  }
  async onModuleDestroy() {
    await this.runtime?.close();
  }
}
