import { documentContracts } from "./openapi";
import "reflect-metadata";
import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  Req,
  Res,
  Headers,
  Module,
  Catch,
  ExceptionFilter,
  ArgumentsHost,
  HttpException,
} from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import {
  SwaggerModule,
  DocumentBuilder,
  ApiTags,
  ApiOperation,
  ApiCookieAuth,
} from "@nestjs/swagger";
import cookieParser from "cookie-parser";
import type { Request, Response } from "express";
import { db } from "./db";
import { AuthRequest, SessionGuard, login, logout, permissions } from "./auth";
import { InsuranceService } from "./service";
import { documentHtml, documentPdf } from "./documents";
@Controller("api/v1")
@ApiTags("ביטוחה")
@ApiCookieAuth("bitucha_session")
class ApiController {
  private service = new InsuranceService();
  @Get("health") async health() {
    await db.$queryRaw`SELECT 1`;
    return { status: "ok", simulation: true };
  }
  @Post("auth/login")
  @ApiOperation({ summary: "התחברות והנפקת session ו־CSRF" })
  login(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() b: any,
  ) {
    const origin = req.get("origin");
    if (
      origin &&
      origin !== (process.env.WEB_ORIGIN || "http://localhost:5173")
    )
      throw new HttpException("מקור אינו מורשה", 403);
    return login(req, res, b);
  }
  @Get("auth/session") session(@Req() req: AuthRequest) {
    return {
      employee: req.actor,
      csrf: req.csrf,
      permissions: permissions[req.actor.role],
    };
  }
  @Post("auth/logout") logout(
    @Req() req: AuthRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    return logout(req, res);
  }
  @Get("customers") customers(@Query("q") q = "") {
    return this.service.customers(q);
  }
  @Post("customers") createCustomer(@Req() r: AuthRequest, @Body() b: any) {
    return this.service.createCustomer(r.actor, b);
  }
  @Patch("customers/:id") updateCustomer(
    @Req() r: AuthRequest,
    @Param("id") id: string,
    @Body() b: any,
  ) {
    return this.service.updateCustomer(r.actor, id, b);
  }
  @Get("customers/:id/workspace") workspace(@Param("id") id: string) {
    return this.service.workspace(id);
  }
  @Post("customers/:id/pets") pet(
    @Req() r: AuthRequest,
    @Param("id") id: string,
    @Body() b: any,
  ) {
    return this.service.createPet(r.actor, id, b);
  }
  @Get("products") products() {
    return this.service.products();
  }
  @Post("policies") quote(
    @Req() r: AuthRequest,
    @Body() b: any,
    @Headers("idempotency-key") key: string,
  ) {
    return this.service.createPolicy(r.actor, b, key);
  }
  @Post("policies/:id/underwrite") underwrite(
    @Req() r: AuthRequest,
    @Param("id") id: string,
    @Body() b: any,
    @Headers("idempotency-key") key: string,
  ) {
    return this.service.underwrite(r.actor, id, b, key);
  }
  @Post("policies/:id/activate") activate(
    @Req() r: AuthRequest,
    @Param("id") id: string,
    @Body() b: any,
    @Headers("idempotency-key") key: string,
  ) {
    return this.service.activate(r.actor, id, b, key);
  }
  @Get("policies/:id/cancellation-preview") preview(
    @Param("id") id: string,
    @Query("at") at: string,
  ) {
    return this.service.cancellationPreview(id, at);
  }
  @Post("policies/:id/cancel") cancel(
    @Req() r: AuthRequest,
    @Param("id") id: string,
    @Body() b: any,
    @Headers("idempotency-key") key: string,
  ) {
    return this.service.cancelPolicy(r.actor, id, b, key);
  }
  @Post("claims") claim(
    @Req() r: AuthRequest,
    @Body() b: any,
    @Headers("idempotency-key") key: string,
  ) {
    return this.service.createClaim(r.actor, b, key);
  }
  @Get("claims/:id/assessment") assess(@Param("id") id: string) {
    return this.service.assess(id);
  }
  @Post("claims/:id/decide") decide(
    @Req() r: AuthRequest,
    @Param("id") id: string,
    @Body() b: any,
    @Headers("idempotency-key") key: string,
  ) {
    return this.service.decideClaim(r.actor, id, b, key);
  }
  @Post("payment-orders/:id/execute-simulated") execute(
    @Req() r: AuthRequest,
    @Param("id") id: string,
    @Headers("idempotency-key") key: string,
  ) {
    return this.service.executePayment(r.actor, id, key);
  }
  @Post("charges/:id/collect-simulated") collect(
    @Req() r: AuthRequest,
    @Param("id") id: string,
    @Body() b: any,
    @Headers("idempotency-key") key: string,
  ) {
    return this.service.collect(r.actor, id, b, key);
  }
  @Post("service-cases") case(@Req() r: AuthRequest, @Body() b: any) {
    return this.service.caseCreate(r.actor, b);
  }
  @Patch("service-cases/:id") caseStatus(
    @Req() r: AuthRequest,
    @Param("id") id: string,
    @Body() b: any,
  ) {
    return this.service.caseStatus(r.actor, id, b);
  }
  @Get("documents/:id/preview") async doc(
    @Param("id") id: string,
    @Res() res: Response,
  ) {
    res.type("html").send(await documentHtml(id));
  }
  @Get("documents/:id/pdf") async pdf(
    @Param("id") id: string,
    @Res() res: Response,
  ) {
    res
      .type("pdf")
      .setHeader(
        "Content-Disposition",
        'inline; filename="bitucha-document.pdf"',
      );
    res.send(await documentPdf(id));
  }
  @Post("documents/:id/sign-simulated") sign(
    @Req() r: AuthRequest,
    @Param("id") id: string,
    @Body() b: any,
    @Headers("idempotency-key") key: string,
  ) {
    return this.service.sign(r.actor, id, b, key);
  }
  @Get("work-queues") async queues() {
    const [underwriting, claims, payments] = await Promise.all([
      db.policy.findMany({
        where: { status: "UNDERWRITING_PENDING" },
        include: { customer: true },
        take: 200,
        orderBy: { createdAt: "asc" },
      }),
      db.claim.findMany({
        where: { status: { in: ["SUBMITTED", "NEEDS_INFORMATION"] } },
        include: { policy: { include: { customer: true } } },
        take: 200,
        orderBy: { createdAt: "asc" },
      }),
      db.paymentOrder.findMany({
        where: { status: "APPROVED" },
        include: {
          claim: { include: { policy: { include: { customer: true } } } },
        },
        take: 200,
        orderBy: { createdAt: "asc" },
      }),
    ]);
    return { underwriting, claims, payments };
  }
  @Post("products/:id/versions") version(
    @Req() r: AuthRequest,
    @Param("id") id: string,
    @Body() b: any,
    @Headers("idempotency-key") key: string,
  ) {
    return this.service.productVersion(r.actor, id, b, key);
  }
  @Post("policies/:id/suspend") suspend(
    @Req() r: AuthRequest,
    @Param("id") id: string,
    @Body() b: any,
    @Headers("idempotency-key") key: string,
  ) {
    return this.service.suspend(r.actor, id, b, key);
  }
  @Post("policies/:id/reinstate") reinstate(
    @Req() r: AuthRequest,
    @Param("id") id: string,
    @Body() b: any,
    @Headers("idempotency-key") key: string,
  ) {
    return this.service.reinstate(r.actor, id, b, key);
  }
  @Post("tasks") task(@Req() r: AuthRequest, @Body() b: any) {
    return this.service.taskCreate(r.actor, b);
  }
  @Post("tasks/:id/complete") taskComplete(
    @Req() r: AuthRequest,
    @Param("id") id: string,
  ) {
    return this.service.taskComplete(r.actor, id);
  }
  @Get("reports") reports() {
    return this.service.reports();
  }
}
@Catch()
class Errors implements ExceptionFilter {
  catch(error: any, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    let status = 500;
    let message = "תקלה פנימית. הפעולה לא הושלמה";
    if (error instanceof HttpException) {
      status = error.getStatus();
      const response = error.getResponse();
      message =
        typeof response === "string" ? response : (response as any).message;
    } else if (error.code === "P2002") {
      status = 409;
      message = "רשומה כפולה — מזהה כבר קיים";
    } else if (error.code === "P2025") {
      status = 404;
      message = "רשומה לא נמצאה";
    } else if (
      error.code === "P2034" ||
      ["40001", "40P01"].includes(
        error.meta?.driverAdapterError?.cause?.originalCode,
      )
    ) {
      status = 409;
      message = "פעולה מקבילה. יש לרענן ולנסות שוב";
    } else console.error("API_ERROR", error.name, error.code || "");
    res.status(status).json({ statusCode: status, message });
  }
}
@Module({ controllers: [ApiController] })
class AppModule {}
export async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.use(cookieParser());
  app.useGlobalGuards(new SessionGuard());
  app.useGlobalFilters(new Errors());
  const config = new DocumentBuilder()
    .setTitle("Bitucha Simulation API")
    .setVersion("0.1.0")
    .setDescription(
      "סביבת פיתוח בלבד. פעולות כספיות מחייבות Idempotency-Key; כתיבה מחייבת X-CSRF-Token מהתחברות.",
    )
    .addCookieAuth(
      "bitucha_session",
      { type: "apiKey", in: "cookie" },
      "bitucha_session",
    )
    .build();
  SwaggerModule.setup(
    "api/docs",
    app,
    documentContracts(SwaggerModule.createDocument(app, config)),
  );
  app.enableShutdownHooks();
  await app.listen(
    Number(process.env.PORT || 3000),
    process.env.API_HOST || "0.0.0.0",
  );
  return app;
}
bootstrap().catch((e) => {
  console.error("STARTUP_ERROR", e.name);
  process.exit(1);
});
