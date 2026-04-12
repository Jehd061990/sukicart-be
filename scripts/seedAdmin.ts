import dotenv from "dotenv";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";

dotenv.config();

const MONGO_URI = process.env.MONGO_URI;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const ADMIN_NAME = process.env.ADMIN_NAME || "Platform Admin";

if (!MONGO_URI) {
  throw new Error("MONGO_URI is required");
}

if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
  throw new Error("ADMIN_EMAIL and ADMIN_PASSWORD are required");
}

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true, lowercase: true },
    password: { type: String, required: true },
    role: { type: String, enum: ["ADMIN", "SELLER", "BUYER", "RIDER"] },
    status: {
      type: String,
      enum: ["active", "inactive", "pending"],
      default: "active",
    },
  },
  { timestamps: true },
);

const User = mongoose.models.User || mongoose.model("User", userSchema);

const run = async () => {
  await mongoose.connect(MONGO_URI);

  const existingAdmin = await User.findOne({ role: "ADMIN" });
  if (existingAdmin) {
    console.log("Admin already exists. No changes made.");
    await mongoose.disconnect();
    return;
  }

  const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 10);

  await User.create({
    name: ADMIN_NAME,
    email: ADMIN_EMAIL.toLowerCase().trim(),
    password: passwordHash,
    role: "ADMIN",
    status: "active",
  });

  console.log("Admin user seeded successfully.");
  await mongoose.disconnect();
};

run().catch(async (error) => {
  console.error("Failed to seed admin:", error.message);
  await mongoose.disconnect();
  process.exit(1);
});
