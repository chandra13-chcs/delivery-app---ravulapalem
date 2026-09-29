"use strict";

async function createUserNotification(queryable, userId, title, body, payload = {}) {
  return queryable.query(
    `INSERT INTO notifications (user_id, channel, status, title, body, payload)
     VALUES ($1, 'IN_APP', 'PENDING', $2, $3, $4::jsonb)`,
    [userId, title, body, JSON.stringify(payload)]
  );
}

async function createPartnerNotifications(queryable, shopId, title, body, payload = {}) {
  return queryable.query(
    `INSERT INTO notifications (user_id, channel, status, title, body, payload)
     SELECT pm.user_id, 'IN_APP', 'PENDING', $2, $3,
            $4::jsonb || jsonb_build_object(
              'recipient_type', 'PARTNER', 'partner_id', p.id, 'shop_id', s.id
            )
     FROM shops s
     JOIN partners p ON p.id = s.partner_id
     JOIN partner_members pm ON pm.partner_id = p.id
     JOIN users u ON u.id = pm.user_id
     WHERE s.id = $1 AND s.deleted_at IS NULL
       AND p.status = 'ACTIVE' AND p.deleted_at IS NULL
       AND pm.status = 'ACTIVE' AND u.status = 'ACTIVE' AND u.deleted_at IS NULL`,
    [shopId, title, body, JSON.stringify(payload)]
  );
}

async function createAdminNotifications(queryable, title, body, payload = {}) {
  return queryable.query(
    `INSERT INTO notifications (user_id, channel, status, title, body, payload)
     SELECT au.user_id, 'IN_APP', 'PENDING', $1, $2,
            $3::jsonb || jsonb_build_object('recipient_type', 'ADMIN')
     FROM admin_users au
     JOIN users u ON u.id = au.user_id
     WHERE au.status = 'ACTIVE' AND u.status = 'ACTIVE' AND u.deleted_at IS NULL`,
    [title, body, JSON.stringify(payload)]
  );
}

module.exports = {
  createUserNotification,
  createPartnerNotifications,
  createAdminNotifications
};
