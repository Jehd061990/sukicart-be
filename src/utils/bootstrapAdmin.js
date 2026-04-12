const User = require("../models/User");
const ROLES = require("../constants/roles");

const bootstrapAdmin = async () => {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  const name = process.env.ADMIN_NAME || "Platform Admin";

  if (!email || !password) {
    return;
  }

  const normalizedEmail = String(email).toLowerCase().trim();
  const existing = await User.findOne({ email: normalizedEmail });

  if (existing) {
    if (existing.role !== ROLES.ADMIN) {
      existing.role = ROLES.ADMIN;
      existing.status = "active";
      await existing.save();
      console.log(`Updated existing user to ADMIN: ${normalizedEmail}`);
    }

    return;
  }

  await User.create({
    name: String(name).trim(),
    email: normalizedEmail,
    password,
    role: ROLES.ADMIN,
    status: "active",
  });

  console.log(`Bootstrapped admin user: ${normalizedEmail}`);
};

module.exports = bootstrapAdmin;
