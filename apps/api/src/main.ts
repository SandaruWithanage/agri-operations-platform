import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  app.enableCors({
    origin: ["http://localhost:3000", "http://localhost:3001"],
  });
  await app.listen(Number(process.env.API_PORT ?? 4000));
}
void bootstrap();
