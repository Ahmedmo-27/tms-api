import mongoose, { Model, Schema, Document } from "mongoose";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { InternalError, NotFoundError } from "../core/ApiError";
import logger from "../config/logger";

// define user tokens
export interface Itoken {
  token: string;
  device: string;
  expiresIn?: string;
}

export interface IUser extends Document {
  email: string;
  password: string;
  name: string;
  phoneNumber: string;
  role: string;
  locationId?: mongoose.Types.ObjectId;
  tokens: Itoken[];
  resetCode: string;
  fcmTokens: string[];
  hasRamadanPackage?: boolean; // Virtual field to check if user has an active Ramadan package
  createdAt: Date;
}

// define user methods interface
export interface IUserMethods {
  comparePassword(password: string): Promise<boolean>;
  generateAuthToken(deviceType: string, fcmToken?: string): Promise<string>;
  removeToken(token: string, fcmToken?: string): Promise<void>;
  removeAllTokens(): Promise<void>;
  removeExpiredTokens(): Promise<void>;
}

// define user model
type UserModel = Model<IUser, {}, IUserMethods> & {
  findByCredentials(
    phoneNumber: string,
    password: string,
  ): Promise<IUser & IUserMethods>;
};

const TokenSchema: Schema<Itoken> = new Schema({
  token: {
    type: String,
    required: true,
  },
  device: {
    type: String,
    required: true,
  },
  expiresIn: {
    type: String,
    required: false,
  },
});

const UserSchema: Schema<IUser, UserModel, IUserMethods> = new Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true,
    match: [
      /^[\w-]+(\.[\w-]+)*@([\w-]+\.)+[a-zA-Z]{2,}$/,
      "Please enter a valid email address",
    ],
  },
  password: {
    type: String,
    required: true,
    trim: true,
  },
  name: {
    type: String,
    required: true,
  },
  phoneNumber: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    match: [
      /^\d{11}$/,
      "Please enter a valid phone number (11 digits without spaces)",
    ],
  },
  role: {
    type: String,
    required: true,
    enum: {
      values: ["member", "user", "admin", "management", "branch_admin", "coach"],
      message: "{VALUE} is not a valid role",
    },
  },
  locationId: {
    type: Schema.Types.ObjectId,
    ref: "Location",
    required: false,
  },
  tokens: [TokenSchema],
  resetCode: {
    type: String,
    default: "",
    trim: true,
  },
  hasRamadanPackage: {
    type: Boolean,
    required: false,
  },
  fcmTokens: {
    type: [String],
    default: [],
  },
  createdAt: {
    type: Date,
    required: true,
    default: Date.now,
  },
});

UserSchema.pre("save", async function (next) {
  const user = this;
  if (user.isModified("password")) {
    try {
      user.password = await bcrypt.hash(user.password, 8);
      next();
    } catch (error) {
      next(error as Error);
    }
  }
});

UserSchema.static(
  "findByCredentials",
  async function (
    phoneNumber: string,
    password: string,
  ): Promise<IUser & IUserMethods> {
    const user = await this.findOne({ phoneNumber });
    if (!user)
      throw new NotFoundError("USER_NOT_FOUND", "User not found", {
        phoneNumber,
      });
    const isValid = await user.comparePassword(password);
    if (!isValid)
      throw new NotFoundError("INVALID_CREDENTIALS", "Invalid credentials", {
        phoneNumber,
      }); // user found but password is invalid
    return user;
  },
);

UserSchema.method(
  "comparePassword",
  async function (password: string): Promise<boolean> {
    try {
      const user = this;
      return await bcrypt.compare(password, user.password);
    } catch (error) {
      throw new InternalError("BCRYPT_ERROR", "Password comparison failed");
    }
  },
);

UserSchema.method(
  "generateAuthToken",
  async function (deviceType: string, fcmToken?: string) {
    const user = this;
    const secret = process.env.JWT_SECRET;
    if (!secret)
      throw new InternalError(
        "JWT_ERROR",
        "JWT_SECRET is not defined in environment variables",
      );
    const tokenData = {
      uid: user._id,
      role: user.role,
      deviceType,
      jti: crypto.randomUUID(),
      iat: Math.floor(Date.now() / 1000),
    };
    const token = jwt.sign(tokenData, secret, { expiresIn: "30d" });
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    // Clean up expired tokens to prevent array growth
    user.tokens = user.tokens.filter((t) => !t.expiresIn || new Date(t.expiresIn) > new Date());

    user.tokens.push({
      token,
      device: deviceType,
      expiresIn: expiresAt,
    });
    logger.info("Generated auth token for user", {
      data: { userId: user._id, deviceType, fcmToken },
    });
    if (fcmToken) user.fcmTokens.push(fcmToken);

    await user.save();
    return token;
  },
);

UserSchema.method("removeToken", async function (token, fcmToken) {
  const user = this;
  user.tokens = user.tokens.filter((t) => t.token !== token);
  if (fcmToken) user.fcmTokens.filter((fcm) => fcm !== fcmToken);
  await user.save();
});

UserSchema.method("removeAllTokens", async function () {
  const user = this;
  user.tokens = [];
  await user.save();
});

UserSchema.method("removeExpiredTokens", async function () {
  const user = this;
  user.tokens = user.tokens.filter((t) => !t.expiresIn || new Date(t.expiresIn) > new Date());
  await user.save();
});

const User = mongoose.model<IUser, UserModel>("User", UserSchema);

export default User;
