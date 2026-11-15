import type { Request, Response, NextFunction } from "express";
import { CreateUserSchema, SigninSchema } from "@repo/common/schemas";
import { AppError } from "../../errors.js";
import * as service from "./service.js";
export async function signup(req: Request, res: Response, next: NextFunction) {
  const result = CreateUserSchema.safeParse(req.body);
  if (!result.success) {
    res.status(400).json({
      message: "Invalid Credential Inputs",
      errors: result.error.flatten(),
    });
    return;
  }
  try {
    await service.signup(result.data);
    res.status(201).json({ message: "User created successfully" });
  } catch (error) {
    next(error);
  }
}
export async function signin(req: Request, res: Response, next: NextFunction) {
  const result = SigninSchema.safeParse(req.body);
  if (!result.success) {
    res
      .status(400)
      .json({ message: "Invalid Credentials", errors: result.error.flatten() });
    return;
  }
  try {
    const token = await service.signin(result.data.email, result.data.password);
    res.json({ message: "Signin successful", token });
  } catch (error) {
    if (error instanceof AppError) {
      res.status(error.status).json({ message: error.message });
      return;
    }
    next(error);
  }
}
