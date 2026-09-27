const bcrypt = require("bcrypt");
const db = require("../config/db");

async function registerUser(req, res) {
  const { phone_e164, email, password, display_name } = req.body || {};

  if (typeof display_name !== "string" || !display_name.trim()) {
    return res.status(400).json({
      success: false,
      message: "display_name is required"
    });
  }

  if (phone_e164 != null && typeof phone_e164 !== "string") {
    return res.status(400).json({
      success: false,
      message: "phone_e164 must be a string"
    });
  }

  if (email != null && typeof email !== "string") {
    return res.status(400).json({
      success: false,
      message: "email must be a string"
    });
  }

  if (password != null && typeof password !== "string") {
    return res.status(400).json({
      success: false,
      message: "password must be a string"
    });
  }

  const phone = phone_e164?.trim() || null;
  const userEmail = email?.trim() || null;

  if (!phone && !userEmail) {
    return res.status(400).json({
      success: false,
      message: "At least one of phone_e164 or email is required"
    });
  }

  if (phone && !/^\+[1-9][0-9]{7,14}$/.test(phone)) {
    return res.status(400).json({
      success: false,
      message: "phone_e164 must be a valid E.164 phone number"
    });
  }

  if (userEmail && userEmail.indexOf("@") < 1) {
    return res.status(400).json({
      success: false,
      message: "email must contain a valid address"
    });
  }

  try {
    const passwordHash = password != null ? await bcrypt.hash(password, 10) : null;
    const result = await db.query(
      `INSERT INTO users (phone_e164, email, password_hash, display_name)
       VALUES ($1, $2, $3, $4)
       RETURNING id, phone_e164, email, display_name, status,
                 phone_verified_at, email_verified_at, created_at, updated_at`,
      [phone, userEmail, passwordHash, display_name.trim()]
    );

    return res.status(201).json({
      success: true,
      user: result.rows[0]
    });
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({
        success: false,
        message: "A user with that phone number or email already exists"
      });
    }

    console.error("User registration failed:", error.message);
    return res.status(500).json({
      success: false,
      message: "Unable to register user"
    });
  }
}

module.exports = { registerUser };