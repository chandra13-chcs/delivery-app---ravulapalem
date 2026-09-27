BEGIN;

-- UUID generation is built into supported PostgreSQL versions; no extension is required.

CREATE FUNCTION set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_e164 varchar(16),
  email text,
  password_hash text,
  display_name text NOT NULL,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'ACTIVE', 'SUSPENDED', 'CLOSED')),
  phone_verified_at timestamptz,
  email_verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CHECK (phone_e164 IS NULL OR phone_e164 ~ '^[+][1-9][0-9]{7,14}$'),
  CHECK (email IS NULL OR position('@' IN email) > 1),
  CHECK (phone_e164 IS NOT NULL OR email IS NOT NULL)
);
CREATE UNIQUE INDEX users_phone_e164_uq ON users (phone_e164) WHERE phone_e164 IS NOT NULL;
CREATE UNIQUE INDEX users_email_lower_uq ON users (lower(email)) WHERE email IS NOT NULL;
CREATE INDEX users_status_idx ON users (status) WHERE deleted_at IS NULL;

CREATE TABLE user_addresses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  label text NOT NULL DEFAULT 'Home',
  recipient_name text NOT NULL,
  recipient_phone_e164 varchar(16) NOT NULL,
  address_line1 text NOT NULL,
  address_line2 text,
  landmark text,
  locality text,
  city text NOT NULL,
  state text NOT NULL,
  postal_code varchar(16) NOT NULL,
  country_code char(2) NOT NULL DEFAULT 'IN',
  latitude numeric(9,6),
  longitude numeric(9,6),
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
  CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180)
);
CREATE INDEX user_addresses_user_idx ON user_addresses (user_id) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX user_addresses_one_default_uq ON user_addresses (user_id)
  WHERE is_default AND deleted_at IS NULL;

CREATE TABLE otp_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  destination text NOT NULL,
  channel text NOT NULL CHECK (channel IN ('SMS', 'EMAIL', 'WHATSAPP')),
  purpose text NOT NULL CHECK (purpose IN ('REGISTER', 'LOGIN', 'PASSWORD_RESET', 'DELIVERY', 'PICKUP', 'PHONE_CHANGE', 'EMAIL_CHANGE')),
  otp_hmac bytea NOT NULL,
  expires_at timestamptz NOT NULL,
  attempt_count smallint NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  max_attempts smallint NOT NULL DEFAULT 5 CHECK (max_attempts > 0),
  consumed_at timestamptz,
  request_ip inet,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at),
  CHECK (attempt_count <= max_attempts)
);
CREATE INDEX otp_verifications_destination_purpose_idx
  ON otp_verifications (destination, purpose, created_at DESC);
CREATE INDEX otp_verifications_expiry_idx ON otp_verifications (expires_at)
  WHERE consumed_at IS NULL;
COMMENT ON COLUMN otp_verifications.otp_hmac IS
  'Store an HMAC using a server-held secret; never store a plaintext or unsalted low-entropy OTP hash.';

CREATE TABLE user_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  refresh_token_hash bytea NOT NULL UNIQUE,
  user_agent text,
  ip_address inet,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);
CREATE INDEX user_sessions_user_expiry_idx ON user_sessions (user_id, expires_at DESC);
CREATE INDEX user_sessions_expiry_idx ON user_sessions (expires_at) WHERE revoked_at IS NULL;
COMMENT ON COLUMN user_sessions.refresh_token_hash IS
  'Store only a cryptographic hash of the high-entropy refresh token.';

CREATE TABLE roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  display_name text NOT NULL,
  description text,
  is_system boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  description text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE user_roles (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  role_id uuid NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
  granted_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, role_id)
);
CREATE INDEX user_roles_role_idx ON user_roles (role_id, user_id);

CREATE TABLE role_permissions (
  role_id uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id uuid NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  granted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE admin_users (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,
  employee_code text UNIQUE,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'SUSPENDED', 'CLOSED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE partners (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_name text NOT NULL,
  display_name text NOT NULL,
  business_type text NOT NULL CHECK (business_type IN ('RESTAURANT', 'GROCERY', 'MEAT', 'OTHER')),
  tax_identifier text,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'ACTIVE', 'SUSPENDED', 'CLOSED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX partners_status_idx ON partners (status) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX partners_tax_identifier_uq ON partners (tax_identifier)
  WHERE tax_identifier IS NOT NULL;

CREATE TABLE partner_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id uuid NOT NULL REFERENCES partners(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  member_role text NOT NULL CHECK (member_role IN ('OWNER', 'MANAGER', 'STAFF')),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('INVITED', 'ACTIVE', 'SUSPENDED', 'REMOVED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (partner_id, user_id)
);
CREATE INDEX partner_members_user_idx ON partner_members (user_id, status);

CREATE TABLE shops (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id uuid NOT NULL REFERENCES partners(id) ON DELETE RESTRICT,
  name text NOT NULL,
  description text,
  cuisine text,
  image_object_key text,
  phone_e164 varchar(16),
  email text,
  address_line1 text NOT NULL,
  address_line2 text,
  locality text,
  city text NOT NULL,
  state text NOT NULL,
  postal_code varchar(16) NOT NULL,
  country_code char(2) NOT NULL DEFAULT 'IN',
  latitude numeric(9,6),
  longitude numeric(9,6),
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'ACTIVE', 'PAUSED', 'SUSPENDED', 'CLOSED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
  CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180)
);
CREATE INDEX shops_partner_status_idx ON shops (partner_id, status) WHERE deleted_at IS NULL;
CREATE INDEX shops_city_postal_idx ON shops (city, postal_code) WHERE status = 'ACTIVE' AND deleted_at IS NULL;

CREATE TABLE shop_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES shops(id) ON DELETE RESTRICT,
  document_type text NOT NULL,
  object_key text NOT NULL,
  original_filename text,
  content_type text,
  verification_status text NOT NULL DEFAULT 'PENDING' CHECK (verification_status IN ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED')),
  reviewed_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (shop_id, object_key)
);
CREATE INDEX shop_documents_review_idx ON shop_documents (verification_status, created_at);

CREATE TABLE shop_hours (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES shops(id) ON DELETE RESTRICT,
  day_of_week smallint NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  opens_at time,
  closes_at time,
  is_closed boolean NOT NULL DEFAULT false,
  slot smallint NOT NULL DEFAULT 1 CHECK (slot > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((is_closed AND opens_at IS NULL AND closes_at IS NULL) OR
         (NOT is_closed AND opens_at IS NOT NULL AND closes_at IS NOT NULL AND opens_at <> closes_at)),
  UNIQUE (shop_id, day_of_week, slot)
);

CREATE TABLE serviceable_areas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  coverage_type text NOT NULL CHECK (coverage_type IN ('POSTAL_CODES', 'RADIUS', 'GEOJSON')),
  postal_codes text[],
  center_latitude numeric(9,6),
  center_longitude numeric(9,6),
  radius_km numeric(7,2),
  boundary_geojson jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (coverage_type = 'POSTAL_CODES' AND postal_codes IS NOT NULL AND cardinality(postal_codes) > 0) OR
    (coverage_type = 'RADIUS' AND center_latitude IS NOT NULL AND center_latitude BETWEEN -90 AND 90 AND
      center_longitude IS NOT NULL AND center_longitude BETWEEN -180 AND 180 AND
      radius_km IS NOT NULL AND radius_km > 0) OR
    (coverage_type = 'GEOJSON' AND boundary_geojson IS NOT NULL AND jsonb_typeof(boundary_geojson) = 'object')
  )
);
CREATE INDEX serviceable_areas_active_idx ON serviceable_areas (is_active, coverage_type);
CREATE INDEX serviceable_areas_postal_codes_gin_idx ON serviceable_areas USING gin (postal_codes);

CREATE TABLE categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid REFERENCES categories(id) ON DELETE RESTRICT,
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  description text,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX categories_parent_active_idx ON categories (parent_id, sort_order) WHERE is_active AND deleted_at IS NULL;

CREATE TABLE products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES shops(id) ON DELETE RESTRICT,
  category_id uuid REFERENCES categories(id) ON DELETE SET NULL,
  name text NOT NULL,
  description text,
  brand text,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX products_shop_status_idx ON products (shop_id, status) WHERE deleted_at IS NULL;
CREATE INDEX products_category_status_idx ON products (category_id, status) WHERE deleted_at IS NULL;
CREATE INDEX products_name_lower_idx ON products (lower(name));

CREATE TABLE product_variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  sku text,
  name text NOT NULL DEFAULT 'Default',
  unit_label text NOT NULL,
  unit_quantity numeric(12,3) NOT NULL DEFAULT 1 CHECK (unit_quantity > 0),
  price numeric(12,2) NOT NULL CHECK (price >= 0),
  compare_at_price numeric(12,2) CHECK (compare_at_price IS NULL OR compare_at_price >= price),
  is_default boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX product_variants_sku_uq ON product_variants (sku) WHERE sku IS NOT NULL;
CREATE INDEX product_variants_product_active_idx ON product_variants (product_id, is_active) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX product_variants_one_default_uq ON product_variants (product_id)
  WHERE is_default AND deleted_at IS NULL;

CREATE TABLE product_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  variant_id uuid REFERENCES product_variants(id) ON DELETE SET NULL,
  object_key text NOT NULL,
  public_url text,
  alt_text text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (product_id, object_key)
);
CREATE INDEX product_images_product_sort_idx ON product_images (product_id, sort_order);

CREATE TABLE inventory (
  variant_id uuid PRIMARY KEY REFERENCES product_variants(id) ON DELETE RESTRICT,
  quantity_on_hand numeric(12,3) NOT NULL DEFAULT 0 CHECK (quantity_on_hand >= 0),
  quantity_reserved numeric(12,3) NOT NULL DEFAULT 0 CHECK (quantity_reserved >= 0),
  low_stock_threshold numeric(12,3) NOT NULL DEFAULT 0 CHECK (low_stock_threshold >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (quantity_reserved <= quantity_on_hand)
);

CREATE TABLE carts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'CONVERTED', 'ABANDONED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, user_id)
);
CREATE UNIQUE INDEX carts_one_active_per_user_uq ON carts (user_id) WHERE status = 'ACTIVE';

CREATE TABLE cart_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cart_id uuid NOT NULL REFERENCES carts(id) ON DELETE CASCADE,
  variant_id uuid NOT NULL REFERENCES product_variants(id) ON DELETE RESTRICT,
  quantity numeric(12,3) NOT NULL CHECK (quantity > 0),
  added_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cart_id, variant_id)
);
CREATE INDEX cart_items_variant_idx ON cart_items (variant_id);

CREATE TABLE orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number text NOT NULL UNIQUE,
  customer_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'PLACED' CHECK (status IN ('DRAFT', 'PLACED', 'ACCEPTED', 'PREPARING', 'READY_FOR_PICKUP', 'PICKING_UP', 'OUT_FOR_DELIVERY', 'DELIVERY_FAILED', 'DELIVERED', 'CANCELLED', 'REJECTED')),
  order_type text NOT NULL DEFAULT 'GOODS' CHECK (order_type IN ('GOODS', 'PARCEL')),
  currency char(3) NOT NULL DEFAULT 'INR',
  subtotal numeric(12,2) NOT NULL CHECK (subtotal >= 0),
  delivery_fee numeric(12,2) NOT NULL DEFAULT 0 CHECK (delivery_fee >= 0),
  tax_amount numeric(12,2) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  discount_amount numeric(12,2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  rider_tip numeric(12,2) NOT NULL DEFAULT 0 CHECK (rider_tip >= 0),
  total_amount numeric(12,2) NOT NULL CHECK (total_amount >= 0),
  coupon_code_snapshot text,
  customer_note text,
  cancellation_reason text,
  cancelled_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  delivery_otp_hmac bytea,
  delivery_otp_expires_at timestamptz,
  delivery_otp_verified_at timestamptz,
  placed_at timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz,
  dispatched_at timestamptz,
  delivered_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (total_amount = subtotal + delivery_fee + tax_amount + rider_tip - discount_amount),
  CHECK (discount_amount <= subtotal + delivery_fee + tax_amount),
  CHECK (delivery_otp_verified_at IS NULL OR delivery_otp_hmac IS NOT NULL)
);
CREATE INDEX orders_customer_created_idx ON orders (customer_user_id, created_at DESC);
CREATE INDEX orders_status_created_idx ON orders (status, created_at DESC);
CREATE INDEX orders_active_created_idx ON orders (created_at DESC)
  WHERE status NOT IN ('DELIVERED', 'CANCELLED', 'REJECTED');

CREATE TABLE order_fulfillments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  shop_id uuid REFERENCES shops(id) ON DELETE SET NULL,
  shop_name_snapshot text NOT NULL,
  pickup_address_snapshot text NOT NULL,
  status text NOT NULL DEFAULT 'PLACED' CHECK (status IN ('PLACED', 'ACCEPTED', 'PREPARING', 'READY_FOR_PICKUP', 'PICKING_UP', 'CANCELLED', 'REJECTED')),
  pickup_otp_hmac bytea,
  pickup_otp_expires_at timestamptz,
  pickup_otp_verified_at timestamptz,
  accepted_at timestamptz,
  ready_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (pickup_otp_verified_at IS NULL OR pickup_otp_hmac IS NOT NULL),
  UNIQUE (order_id, shop_id),
  UNIQUE (id, order_id)
);
CREATE INDEX order_fulfillments_shop_status_idx ON order_fulfillments (shop_id, status, created_at DESC);
CREATE INDEX order_fulfillments_order_idx ON order_fulfillments (order_id);
COMMENT ON COLUMN orders.status IS
  'Canonical database status. Legacy frontend PACKED maps to READY_FOR_PICKUP; DISPATCHED maps to OUT_FOR_DELIVERY.';
COMMENT ON COLUMN order_fulfillments.status IS
  'Canonical per-shop fulfillment status. Legacy frontend PACKED maps to READY_FOR_PICKUP.';

CREATE TABLE order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  fulfillment_id uuid,
  product_id uuid REFERENCES products(id) ON DELETE SET NULL,
  variant_id uuid REFERENCES product_variants(id) ON DELETE SET NULL,
  product_name_snapshot text NOT NULL,
  variant_name_snapshot text,
  sku_snapshot text,
  unit_snapshot text NOT NULL,
  quantity numeric(12,3) NOT NULL CHECK (quantity > 0),
  unit_price numeric(12,2) NOT NULL CHECK (unit_price >= 0),
  discount_amount numeric(12,2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  tax_amount numeric(12,2) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  line_total numeric(12,2) NOT NULL CHECK (line_total >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (discount_amount <= quantity * unit_price),
  CHECK (line_total = round(quantity * unit_price - discount_amount + tax_amount, 2)),
  FOREIGN KEY (fulfillment_id, order_id)
    REFERENCES order_fulfillments (id, order_id) ON DELETE RESTRICT
);
CREATE INDEX order_items_order_idx ON order_items (order_id);
CREATE INDEX order_items_fulfillment_idx ON order_items (fulfillment_id);
CREATE INDEX order_items_product_idx ON order_items (product_id) WHERE product_id IS NOT NULL;

CREATE TABLE order_addresses (
  order_id uuid PRIMARY KEY REFERENCES orders(id) ON DELETE RESTRICT,
  recipient_name text NOT NULL,
  recipient_phone_e164 varchar(16) NOT NULL,
  address_line1 text NOT NULL,
  address_line2 text,
  landmark text,
  locality text,
  city text NOT NULL,
  state text NOT NULL,
  postal_code varchar(16) NOT NULL,
  country_code char(2) NOT NULL DEFAULT 'IN',
  latitude numeric(9,6),
  longitude numeric(9,6),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
  CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180)
);

CREATE TABLE parcel_details (
  order_id uuid PRIMARY KEY REFERENCES orders(id) ON DELETE RESTRICT,
  parcel_pickup_address text NOT NULL,
  parcel_drop_address text NOT NULL,
  parcel_description text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE order_status_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  from_status text,
  to_status text NOT NULL,
  changed_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  change_source text NOT NULL DEFAULT 'APPLICATION',
  reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX order_status_history_order_time_idx ON order_status_history (order_id, created_at DESC);

CREATE TABLE fulfillment_status_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fulfillment_id uuid NOT NULL REFERENCES order_fulfillments(id) ON DELETE RESTRICT,
  from_status text,
  to_status text NOT NULL,
  changed_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX fulfillment_status_history_time_idx ON fulfillment_status_history (fulfillment_id, created_at DESC);

CREATE TABLE riders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE RESTRICT,
  verification_status text NOT NULL DEFAULT 'PENDING' CHECK (verification_status IN ('PENDING', 'SUBMITTED', 'APPROVED', 'REJECTED', 'SUSPENDED')),
  is_available boolean NOT NULL DEFAULT false,
  vehicle_type text,
  vehicle_registration text,
  license_number_last4 char(4),
  approved_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX riders_availability_idx ON riders (is_available, verification_status) WHERE deleted_at IS NULL;

CREATE TABLE rider_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rider_id uuid NOT NULL REFERENCES riders(id) ON DELETE RESTRICT,
  document_type text NOT NULL,
  object_key text NOT NULL,
  original_filename text,
  content_type text,
  verification_status text NOT NULL DEFAULT 'PENDING' CHECK (verification_status IN ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED')),
  reviewed_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (rider_id, object_key)
);
CREATE INDEX rider_documents_review_idx ON rider_documents (verification_status, created_at);

CREATE TABLE rider_availability (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rider_id uuid NOT NULL REFERENCES riders(id) ON DELETE RESTRICT,
  is_available boolean NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  source text NOT NULL DEFAULT 'RIDER_APP',
  CHECK (ended_at IS NULL OR ended_at >= started_at)
);
CREATE INDEX rider_availability_history_idx ON rider_availability (rider_id, started_at DESC);
CREATE UNIQUE INDEX rider_availability_one_open_uq ON rider_availability (rider_id) WHERE ended_at IS NULL;

CREATE TABLE delivery_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  fulfillment_id uuid,
  rider_id uuid NOT NULL REFERENCES riders(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'OFFERED' CHECK (status IN ('OFFERED', 'ACCEPTED', 'REJECTED', 'PICKING_UP', 'OUT_FOR_DELIVERY', 'COMPLETED', 'CANCELLED')),
  assigned_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz,
  completed_at timestamptz,
  rejection_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (fulfillment_id, order_id)
    REFERENCES order_fulfillments (id, order_id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX delivery_assignments_one_active_order_uq ON delivery_assignments (order_id)
  WHERE status IN ('OFFERED', 'ACCEPTED', 'PICKING_UP', 'OUT_FOR_DELIVERY');
CREATE INDEX delivery_assignments_rider_status_idx ON delivery_assignments (rider_id, status, assigned_at DESC);
CREATE INDEX delivery_assignments_fulfillment_idx ON delivery_assignments (fulfillment_id) WHERE fulfillment_id IS NOT NULL;

CREATE TABLE rider_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rider_id uuid NOT NULL REFERENCES riders(id) ON DELETE RESTRICT,
  assignment_id uuid REFERENCES delivery_assignments(id) ON DELETE SET NULL,
  latitude numeric(9,6) NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude numeric(9,6) NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  accuracy_m numeric(8,2) CHECK (accuracy_m IS NULL OR accuracy_m >= 0),
  heading_degrees numeric(6,2) CHECK (heading_degrees IS NULL OR heading_degrees BETWEEN 0 AND 360),
  speed_mps numeric(8,2) CHECK (speed_mps IS NULL OR speed_mps >= 0),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '30 days')
);
CREATE INDEX rider_locations_rider_time_idx ON rider_locations (rider_id, recorded_at DESC);
CREATE INDEX rider_locations_assignment_time_idx ON rider_locations (assignment_id, recorded_at DESC)
  WHERE assignment_id IS NOT NULL;
CREATE INDEX rider_locations_expiry_idx ON rider_locations (expires_at);
CREATE INDEX rider_locations_recorded_brin_idx ON rider_locations USING brin (recorded_at);
COMMENT ON TABLE rider_locations IS
  'GPS history is retained for 30 days by default; a scheduled retention job must purge expired rows.';

CREATE TABLE delivery_tracking (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id uuid NOT NULL REFERENCES delivery_assignments(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (event_type IN ('ASSIGNED', 'ACCEPTED', 'REJECTED', 'ARRIVED_AT_PICKUP', 'PICKUP_CONFIRMED', 'OUT_FOR_DELIVERY', 'DELIVERY_ATTEMPT_FAILED', 'DELIVERED', 'CANCELLED')),
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  latitude numeric(9,6),
  longitude numeric(9,6),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
  CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180)
);
CREATE INDEX delivery_tracking_assignment_time_idx ON delivery_tracking (assignment_id, occurred_at DESC);
CREATE INDEX delivery_tracking_event_time_idx ON delivery_tracking (event_type, occurred_at DESC);
COMMENT ON COLUMN delivery_tracking.event_type IS
  'Legacy frontend pickup_reached maps to ARRIVED_AT_PICKUP; pickup_completed maps to PICKUP_CONFIRMED.';
COMMENT ON COLUMN delivery_tracking.details IS
  'May include the legacy pickup source key for per-source pickup_reached/pickup_completed events.';

CREATE TABLE payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  method text NOT NULL CHECK (method IN ('COD', 'UPI')),
  provider text NOT NULL DEFAULT 'MANUAL' CHECK (provider IN ('MANUAL', 'GATEWAY')),
  provider_name text,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'INITIATED', 'SUCCESSFUL', 'FAILED', 'REFUNDED', 'CANCELLED')),
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  currency char(3) NOT NULL DEFAULT 'INR',
  provider_order_reference text,
  idempotency_key text,
  initiated_at timestamptz,
  confirmed_at timestamptz,
  failed_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (method <> 'COD' OR provider = 'MANUAL'),
  CHECK (status <> 'SUCCESSFUL' OR confirmed_at IS NOT NULL)
);
CREATE INDEX payments_order_created_idx ON payments (order_id, created_at DESC);
CREATE INDEX payments_status_created_idx ON payments (status, created_at DESC);
CREATE UNIQUE INDEX payments_provider_order_ref_uq ON payments (provider_name, provider_order_reference)
  WHERE provider_order_reference IS NOT NULL;
CREATE UNIQUE INDEX payments_idempotency_key_uq ON payments (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE TABLE payment_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid NOT NULL REFERENCES payments(id) ON DELETE RESTRICT,
  transaction_type text NOT NULL CHECK (transaction_type IN ('INITIATE', 'AUTHORIZE', 'CAPTURE', 'VERIFY', 'FAILURE', 'CANCEL')),
  status text NOT NULL CHECK (status IN ('PENDING', 'SUCCESSFUL', 'FAILED')),
  amount numeric(12,2) NOT NULL CHECK (amount >= 0),
  provider_transaction_reference text,
  idempotency_key text,
  sanitized_request jsonb NOT NULL DEFAULT '{}'::jsonb,
  sanitized_response jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payment_transactions_payment_time_idx ON payment_transactions (payment_id, occurred_at DESC);
CREATE UNIQUE INDEX payment_transactions_provider_ref_uq ON payment_transactions (provider_transaction_reference)
  WHERE provider_transaction_reference IS NOT NULL;
CREATE UNIQUE INDEX payment_transactions_idempotency_uq ON payment_transactions (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE TABLE refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid NOT NULL REFERENCES payments(id) ON DELETE RESTRICT,
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'INITIATED', 'SUCCESSFUL', 'FAILED', 'CANCELLED')),
  reason text,
  provider_refund_reference text,
  initiated_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  initiated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX refunds_payment_status_idx ON refunds (payment_id, status);
CREATE UNIQUE INDEX refunds_provider_reference_uq ON refunds (provider_refund_reference)
  WHERE provider_refund_reference IS NOT NULL;

CREATE TABLE notification_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_key text NOT NULL,
  channel text NOT NULL CHECK (channel IN ('IN_APP', 'PUSH', 'SMS', 'EMAIL', 'WHATSAPP')),
  locale text NOT NULL DEFAULT 'en-IN',
  subject_template text,
  body_template text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (template_key, channel, locale)
);

CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  template_id uuid REFERENCES notification_templates(id) ON DELETE SET NULL,
  channel text NOT NULL CHECK (channel IN ('IN_APP', 'PUSH', 'SMS', 'EMAIL', 'WHATSAPP')),
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'CANCELLED')),
  title text,
  body text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  provider_reference text,
  scheduled_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user_unread_idx ON notifications (user_id, created_at DESC)
  WHERE read_at IS NULL;
CREATE INDEX notifications_dispatch_idx ON notifications (status, scheduled_at)
  WHERE status = 'PENDING';

CREATE TABLE notification_preferences (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  channel text NOT NULL CHECK (channel IN ('IN_APP', 'PUSH', 'SMS', 'EMAIL', 'WHATSAPP')),
  topic text NOT NULL DEFAULT 'GENERAL',
  is_enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, channel, topic)
);

CREATE TABLE user_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  provider text NOT NULL CHECK (provider IN ('WEB_PUSH', 'FCM', 'APNS')),
  device_type text NOT NULL CHECK (device_type IN ('WEB', 'ANDROID', 'IOS')),
  subscription_fingerprint bytea NOT NULL,
  subscription_ciphertext bytea NOT NULL,
  encryption_key_version text NOT NULL,
  device_label text,
  last_seen_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, subscription_fingerprint)
);
CREATE INDEX user_devices_active_user_idx ON user_devices (user_id, last_seen_at DESC)
  WHERE revoked_at IS NULL;
COMMENT ON COLUMN user_devices.subscription_ciphertext IS
  'Application-encrypted push token or subscription payload; encryption keys and provider private credentials must remain outside the database.';
COMMENT ON COLUMN user_devices.subscription_fingerprint IS
  'Non-reversible fingerprint used for deduplication; do not store the raw push token or endpoint here.';

CREATE TABLE product_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  rating smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  review_text text,
  status text NOT NULL DEFAULT 'PUBLISHED' CHECK (status IN ('PENDING', 'PUBLISHED', 'HIDDEN', 'REJECTED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX product_reviews_user_order_product_uq ON product_reviews (user_id, order_id, product_id);
CREATE INDEX product_reviews_product_status_time_idx ON product_reviews (product_id, status, created_at DESC);

CREATE TABLE shop_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  shop_id uuid NOT NULL REFERENCES shops(id) ON DELETE RESTRICT,
  rating smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  review_text text,
  status text NOT NULL DEFAULT 'PUBLISHED' CHECK (status IN ('PENDING', 'PUBLISHED', 'HIDDEN', 'REJECTED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX shop_reviews_user_order_shop_uq ON shop_reviews (user_id, order_id, shop_id);
CREATE INDEX shop_reviews_shop_status_time_idx ON shop_reviews (shop_id, status, created_at DESC);

CREATE TABLE rider_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  rider_id uuid NOT NULL REFERENCES riders(id) ON DELETE RESTRICT,
  rating smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  review_text text,
  status text NOT NULL DEFAULT 'PUBLISHED' CHECK (status IN ('PENDING', 'PUBLISHED', 'HIDDEN', 'REJECTED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX rider_reviews_user_order_rider_uq ON rider_reviews (user_id, order_id, rider_id);
CREATE INDEX rider_reviews_rider_status_time_idx ON rider_reviews (rider_id, status, created_at DESC);

CREATE TABLE promotions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SCHEDULED', 'ACTIVE', 'PAUSED', 'ENDED')),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);
CREATE INDEX promotions_status_window_idx ON promotions (status, starts_at, ends_at);

CREATE TABLE coupons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  promotion_id uuid REFERENCES promotions(id) ON DELETE SET NULL,
  code text NOT NULL,
  discount_type text NOT NULL CHECK (discount_type IN ('FIXED', 'PERCENT')),
  discount_value numeric(12,2) NOT NULL CHECK (discount_value > 0),
  max_discount_amount numeric(12,2) CHECK (max_discount_amount IS NULL OR max_discount_amount > 0),
  minimum_order_amount numeric(12,2) NOT NULL DEFAULT 0 CHECK (minimum_order_amount >= 0),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  total_redemption_limit integer CHECK (total_redemption_limit IS NULL OR total_redemption_limit > 0),
  per_user_redemption_limit integer NOT NULL DEFAULT 1 CHECK (per_user_redemption_limit > 0),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at),
  CHECK (discount_type <> 'PERCENT' OR discount_value <= 100)
);
CREATE UNIQUE INDEX coupons_code_lower_uq ON coupons (lower(code));
CREATE INDEX coupons_active_window_idx ON coupons (is_active, starts_at, ends_at);

CREATE TABLE coupon_redemptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coupon_id uuid NOT NULL REFERENCES coupons(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  order_id uuid NOT NULL UNIQUE REFERENCES orders(id) ON DELETE RESTRICT,
  discount_amount numeric(12,2) NOT NULL CHECK (discount_amount >= 0),
  redeemed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (coupon_id, user_id, order_id)
);
CREATE INDEX coupon_redemptions_coupon_user_idx ON coupon_redemptions (coupon_id, user_id, redeemed_at DESC);

CREATE TABLE support_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_number text NOT NULL UNIQUE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  order_id uuid REFERENCES orders(id) ON DELETE SET NULL,
  category text NOT NULL,
  priority text NOT NULL DEFAULT 'NORMAL' CHECK (priority IN ('LOW', 'NORMAL', 'HIGH', 'URGENT')),
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'IN_PROGRESS', 'WAITING_FOR_USER', 'RESOLVED', 'CLOSED')),
  subject text NOT NULL,
  assigned_to_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz
);
CREATE INDEX support_tickets_user_status_time_idx ON support_tickets (user_id, status, created_at DESC);
CREATE INDEX support_tickets_assignee_status_idx ON support_tickets (assigned_to_user_id, status);

CREATE TABLE support_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES support_tickets(id) ON DELETE RESTRICT,
  sender_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  is_internal boolean NOT NULL DEFAULT false,
  body text NOT NULL,
  attachments jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(attachments) = 'array'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX support_messages_ticket_time_idx ON support_messages (ticket_id, created_at);

CREATE TABLE audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  request_id text,
  ip_address inet,
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_entity_time_idx ON audit_logs (entity_type, entity_id, created_at DESC);
CREATE INDEX audit_logs_actor_time_idx ON audit_logs (actor_user_id, created_at DESC);
CREATE INDEX audit_logs_created_brin_idx ON audit_logs USING brin (created_at);

CREATE TABLE app_settings (
  setting_key text PRIMARY KEY,
  setting_value jsonb NOT NULL,
  description text,
  is_public boolean NOT NULL DEFAULT false,
  updated_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE banners (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  image_object_key text NOT NULL,
  image_url text,
  destination_url text,
  placement text NOT NULL DEFAULT 'HOME',
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SCHEDULED', 'ACTIVE', 'PAUSED', 'ENDED')),
  starts_at timestamptz,
  ends_at timestamptz,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (starts_at IS NULL OR ends_at IS NULL OR ends_at > starts_at)
);
CREATE INDEX banners_placement_status_idx ON banners (placement, status, sort_order);

CREATE FUNCTION enforce_order_status_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  allowed boolean := false;
BEGIN
  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;

  allowed := CASE OLD.status
    WHEN 'DRAFT' THEN NEW.status IN ('PLACED', 'CANCELLED')
    WHEN 'PLACED' THEN NEW.status IN ('ACCEPTED', 'CANCELLED', 'REJECTED')
    WHEN 'ACCEPTED' THEN NEW.status IN ('PREPARING', 'READY_FOR_PICKUP', 'CANCELLED')
    WHEN 'PREPARING' THEN NEW.status IN ('READY_FOR_PICKUP', 'CANCELLED')
    WHEN 'READY_FOR_PICKUP' THEN NEW.status IN ('PICKING_UP', 'CANCELLED')
    WHEN 'PICKING_UP' THEN NEW.status IN ('OUT_FOR_DELIVERY', 'CANCELLED')
    WHEN 'OUT_FOR_DELIVERY' THEN NEW.status IN ('DELIVERED', 'DELIVERY_FAILED')
    WHEN 'DELIVERY_FAILED' THEN NEW.status IN ('OUT_FOR_DELIVERY', 'CANCELLED')
    ELSE false
  END;

  IF NOT allowed THEN
    RAISE EXCEPTION 'Invalid order status transition: % -> %', OLD.status, NEW.status
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION enforce_order_initial_status()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status NOT IN ('DRAFT', 'PLACED') THEN
    RAISE EXCEPTION 'New orders must start as DRAFT or PLACED, not %', NEW.status
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION record_order_status_history()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  actor_id uuid;
  source_name text;
  change_reason text;
BEGIN
  actor_id := NULLIF(current_setting('app.user_id', true), '')::uuid;
  source_name := COALESCE(NULLIF(current_setting('app.change_source', true), ''), 'APPLICATION');
  change_reason := NULLIF(current_setting('app.change_reason', true), '');
  INSERT INTO order_status_history (order_id, from_status, to_status, changed_by_user_id, change_source, reason)
  VALUES (NEW.id, CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.status END,
          NEW.status, actor_id, source_name, change_reason);
  RETURN NEW;
END;
$$;

CREATE TRIGGER orders_status_transition_guard
  BEFORE UPDATE OF status ON orders
  FOR EACH ROW EXECUTE FUNCTION enforce_order_status_transition();
CREATE TRIGGER orders_status_history_insert
  AFTER INSERT ON orders
  FOR EACH ROW EXECUTE FUNCTION record_order_status_history();
CREATE TRIGGER orders_status_history_update
  AFTER UPDATE OF status ON orders
  FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION record_order_status_history();

CREATE FUNCTION enforce_payment_status_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  allowed boolean := false;
BEGIN
  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;

  allowed := CASE OLD.status
    WHEN 'PENDING' THEN NEW.status IN ('INITIATED', 'FAILED', 'CANCELLED')
    WHEN 'INITIATED' THEN NEW.status IN ('SUCCESSFUL', 'FAILED', 'CANCELLED')
    WHEN 'FAILED' THEN NEW.status IN ('INITIATED', 'CANCELLED')
    WHEN 'SUCCESSFUL' THEN NEW.status = 'REFUNDED'
    ELSE false
  END;

  IF NOT allowed THEN
    RAISE EXCEPTION 'Invalid payment status transition: % -> %', OLD.status, NEW.status
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE FUNCTION enforce_payment_initial_status()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status <> 'PENDING' THEN
    RAISE EXCEPTION 'New payments must start as PENDING, not %', NEW.status
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER orders_initial_status_guard
  BEFORE INSERT ON orders
  FOR EACH ROW EXECUTE FUNCTION enforce_order_initial_status();
CREATE TRIGGER payments_status_transition_guard
  BEFORE UPDATE OF status ON payments
  FOR EACH ROW EXECUTE FUNCTION enforce_payment_status_transition();
CREATE TRIGGER payments_initial_status_guard
  BEFORE INSERT ON payments
  FOR EACH ROW EXECUTE FUNCTION enforce_payment_initial_status();

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'users', 'user_addresses', 'admin_users', 'partners', 'partner_members', 'shops',
    'shop_documents', 'shop_hours', 'serviceable_areas', 'categories', 'products',
    'product_variants', 'inventory', 'carts', 'cart_items', 'orders', 'order_fulfillments',
    'riders', 'rider_documents', 'delivery_assignments', 'payments', 'refunds',
    'notification_templates', 'notifications', 'product_reviews', 'shop_reviews',
    'rider_reviews', 'promotions', 'coupons', 'support_tickets', 'app_settings', 'banners',
    'notification_preferences', 'user_devices'
  ] LOOP
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()',
      table_name || '_set_updated_at', table_name
    );
  END LOOP;
END;
$$;

COMMIT;
