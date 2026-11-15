import bcrypt from "bcrypt";
import { client } from "@repo/db/client";
import { signAccessToken } from "@repo/backend/config";
import { serverEnv } from "@repo/backend/env";
import { AppError } from "../../errors.js";

export async function signup(input: {
  email: string;
  username: string;
  name: string;
  password: string;
  photo?: string;
}) {
  const password = await bcrypt.hash(input.password, 12);
  try {
    await client.user.create({
      data: { ...input, password, photo: input.photo || null },
    });
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "P2002"
    )
      throw new AppError(
        409,
        "User with this email or username already exists",
        "USER_EXISTS",
      );
    throw error;
  }
}
export async function signin(email: string, password: string) {
  const user = await client.user.findUnique({
    where: { email },
    select: { id: true, password: true },
  });
  if (!user || !(await bcrypt.compare(password, user.password)))
    throw new AppError(401, "Invalid credentials", "INVALID_CREDENTIALS");
  return signAccessToken(user.id, serverEnv().JWT_SECRET);
}
