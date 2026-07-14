-- Migration 032: Add production_messages table for Order Conversation
-- Stores order-specific conversations between Sales, Support, Production Manager, Admin

CREATE TABLE IF NOT EXISTS production_messages (
  id serial PRIMARY KEY,
  production_order_id integer NOT NULL REFERENCES production_orders(id) ON DELETE CASCADE,
  sender_id integer REFERENCES users(id) ON DELETE SET NULL,
  sender_name text NOT NULL,
  sender_role text NOT NULL,
  message text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_production_messages_order_id ON production_messages(production_order_id);
CREATE INDEX IF NOT EXISTS idx_production_messages_created_at ON production_messages(production_order_id, created_at);
