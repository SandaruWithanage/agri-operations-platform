import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { AppModule } from "./app.module";
import {
  applyHttpHardening,
  hardeningFromEnv,
} from "./security/http-hardening";

async function bootstrap(): Promise<void> {
  // The default body parsers are disabled; `applyHttpHardening` registers a size-capped JSON parser only.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
  });
  app.enableShutdownHooks();
  applyHttpHardening(app, hardeningFromEnv(process.env));
  await app.listen(Number(process.env.API_PORT ?? 4000));
}
void bootstrap();
