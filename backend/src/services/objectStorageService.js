"use strict";

const { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

const REQUIRED_ENV_VARS = [
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET_NAME",
  "R2_ENDPOINT"
];

function normalizeEndpoint(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed.replace(/\/+$/, "");
  }
  return `https://${trimmed.replace(/\/+$/, "")}`;
}

function getObjectStorageConfig() {
  const accountId = typeof process.env.R2_ACCOUNT_ID === "string" ? process.env.R2_ACCOUNT_ID.trim() : "";
  const accessKeyId = typeof process.env.R2_ACCESS_KEY_ID === "string" ? process.env.R2_ACCESS_KEY_ID.trim() : "";
  const secretAccessKey = typeof process.env.R2_SECRET_ACCESS_KEY === "string" ? process.env.R2_SECRET_ACCESS_KEY.trim() : "";
  const bucketName = typeof process.env.R2_BUCKET_NAME === "string" ? process.env.R2_BUCKET_NAME.trim() : "";
  const endpoint = normalizeEndpoint(process.env.R2_ENDPOINT);

  if (!accountId || !accessKeyId || !secretAccessKey || !bucketName || !endpoint) {
    return null;
  }

  return {
    accountId,
    accessKeyId,
    secretAccessKey,
    bucketName,
    endpoint
  };
}

function isObjectStorageConfigured() {
  return Boolean(getObjectStorageConfig());
}

function createStorageClient() {
  const config = getObjectStorageConfig();
  if (!config) return null;

  return new S3Client({
    region: "auto",
    endpoint: config.endpoint,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey
    },
    forcePathStyle: true
  });
}

async function uploadFile({ key, fileBuffer, contentType, metadata = {} } = {}) {
  if (!key || !fileBuffer) {
    return {
      success: false,
      code: "OBJECT_STORAGE_UPLOAD_INVALID",
      message: "A storage key and file payload are required."
    };
  }

  const config = getObjectStorageConfig();
  if (!config) {
    return {
      success: false,
      code: "OBJECT_STORAGE_NOT_CONFIGURED",
      message: "Secure document storage is not configured yet."
    };
  }

  const client = createStorageClient();
  if (!client) {
    return {
      success: false,
      code: "OBJECT_STORAGE_NOT_CONFIGURED",
      message: "Secure document storage is not configured yet."
    };
  }

  const body = Buffer.isBuffer(fileBuffer) ? fileBuffer : Buffer.from(fileBuffer);
  const safeMetadata = Object.entries(metadata || {}).reduce((result, [name, value]) => {
    if (typeof value === "string" && value.trim()) {
      result[name] = value.trim();
    }
    return result;
  }, {});

  try {
    await client.send(new PutObjectCommand({
      Bucket: config.bucketName,
      Key: key,
      Body: body,
      ContentType: typeof contentType === "string" && contentType.trim() ? contentType.trim() : "application/octet-stream",
      Metadata: safeMetadata
    }));

    return {
      success: true,
      key,
      bucket: config.bucketName,
      contentType: typeof contentType === "string" && contentType.trim() ? contentType.trim() : "application/octet-stream"
    };
  } catch (error) {
    return {
      success: false,
      code: "OBJECT_STORAGE_UPLOAD_FAILED",
      message: error?.message || "Secure document storage upload failed."
    };
  }
}

async function deleteFile(key) {
  if (!key) {
    return { success: false, code: "OBJECT_STORAGE_DELETE_INVALID", message: "A storage key is required for deletion." };
  }

  const config = getObjectStorageConfig();
  if (!config) {
    return { success: false, code: "OBJECT_STORAGE_NOT_CONFIGURED", message: "Secure document storage is not configured yet." };
  }

  const client = createStorageClient();
  if (!client) {
    return { success: false, code: "OBJECT_STORAGE_NOT_CONFIGURED", message: "Secure document storage is not configured yet." };
  }

  try {
    await client.send(new DeleteObjectCommand({
      Bucket: config.bucketName,
      Key: key
    }));
    return { success: true, key };
  } catch (error) {
    return {
      success: false,
      code: "OBJECT_STORAGE_DELETE_FAILED",
      message: error?.message || "Could not remove the uploaded object."
    };
  }
}

async function getSignedFileUrl(key, options = {}) {
  if (!key) return null;

  const config = getObjectStorageConfig();
  if (!config) return null;

  const client = createStorageClient();
  if (!client) return null;

  const expiresIn = Number(options.expiresIn || 300);
  const command = new GetObjectCommand({
    Bucket: config.bucketName,
    Key: key
  });

  try {
    return await getSignedUrl(client, command, {
      expiresIn: Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 300
    });
  } catch (error) {
    console.error("Object storage signed URL generation failed:", error.message);
    return null;
  }
}

function getPrivateFileUrl(key, options = {}) {
  return getSignedFileUrl(key, options);
}

module.exports = {
  REQUIRED_ENV_VARS,
  getObjectStorageConfig,
  isObjectStorageConfigured,
  createStorageClient,
  uploadFile,
  deleteFile,
  getSignedFileUrl,
  getPrivateFileUrl
};
