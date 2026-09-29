INSERT INTO permissions (code, description)
VALUES ('partners:manage', 'Manage partner accounts, members, shops, and partner catalog operations.')
ON CONFLICT (code) DO NOTHING;
