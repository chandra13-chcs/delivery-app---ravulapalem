"use strict";

async function writeAuditLog(queryable, req, action, entityType, entityId, beforeData, afterData) {
  await queryable.query(
    `INSERT INTO audit_logs
       (actor_user_id, action, entity_type, entity_id, request_id, ip_address, before_data, after_data)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb)`,
    [
      req.admin?.id || req.user?.id || null,
      action,
      entityType,
      entityId,
      req.get?.("x-request-id") || null,
      req.ip || null,
      beforeData == null ? null : JSON.stringify(beforeData),
      afterData == null ? null : JSON.stringify(afterData)
    ]
  );
}

module.exports = { writeAuditLog };
