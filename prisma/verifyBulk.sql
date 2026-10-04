\pset footer off

-- Scope every check to rows this generator produced. A temp view shadows the
-- real table for unqualified references (pg_temp sits first in search_path), so
-- the assertions below read unchanged while ignoring anything a previous
-- session left in this database.
CREATE TEMP VIEW orders AS
  SELECT o.* FROM public.orders o
    JOIN public.users u ON u.id = o.user_id
   WHERE u.email LIKE '%@vault-demo.test';

CREATE TEMP VIEW order_items AS
  SELECT i.* FROM public.order_items i WHERE i.order_id IN (SELECT id FROM orders);

CREATE TEMP VIEW order_events AS
  SELECT e.* FROM public.order_events e WHERE e.order_id IN (SELECT id FROM orders);

CREATE TEMP VIEW payments AS
  SELECT p.* FROM public.payments p WHERE p.order_id IN (SELECT id FROM orders);

CREATE TEMP VIEW returns AS
  SELECT r.* FROM public.returns r WHERE r.order_item_id IN (SELECT id FROM order_items);

-- Every row is a violation count. All must be 0.
WITH checks AS (

-- ---- order lifecycle timestamps -------------------------------------------
SELECT 'shipped/delivered/fulfilled without shipped_at' AS assertion, count(*) AS bad
  FROM orders WHERE status IN ('shipped','delivered','fulfilled') AND shipped_at IS NULL
UNION ALL SELECT 'delivered/fulfilled without delivered_at',  count(*)
  FROM orders WHERE status IN ('delivered','fulfilled') AND delivered_at IS NULL
UNION ALL SELECT 'pending/paid/cancelled with shipped_at',    count(*)
  FROM orders WHERE status IN ('pending_payment','paid','cancelled') AND shipped_at IS NOT NULL
UNION ALL SELECT 'shipped/paid with delivered_at',            count(*)
  FROM orders WHERE status IN ('shipped','paid','pending_payment') AND delivered_at IS NOT NULL
UNION ALL SELECT 'delivered_at before shipped_at',            count(*)
  FROM orders WHERE delivered_at IS NOT NULL AND shipped_at IS NOT NULL AND delivered_at <= shipped_at
UNION ALL SELECT 'shipped_at before created_at',              count(*)
  FROM orders WHERE shipped_at IS NOT NULL AND shipped_at <= created_at
UNION ALL SELECT 'order placed in the future',                count(*)
  FROM orders WHERE created_at > (now() at time zone 'UTC')
UNION ALL SELECT 'order predates its account',                count(*)
  FROM orders o JOIN users u ON u.id = o.user_id WHERE o.created_at < u.created_at
UNION ALL SELECT 'expected_delivery not shipped_at + 5d',     count(*)
  FROM orders WHERE shipped_at IS NOT NULL
   AND (expected_delivery_at IS NULL
        OR abs(EXTRACT(EPOCH FROM (expected_delivery_at - shipped_at)) - 5*86400) > 2)
UNION ALL SELECT 'expires_at set on a non-pending order',     count(*)
  FROM orders WHERE status <> 'pending_payment' AND expires_at IS NOT NULL
UNION ALL SELECT 'pending order without a 15-minute hold',    count(*)
  FROM orders WHERE status = 'pending_payment'
   AND (expires_at IS NULL OR abs(EXTRACT(EPOCH FROM (expires_at - created_at)) - 900) > 2)

-- ---- structural integrity ---------------------------------------------------
UNION ALL SELECT 'order with no lines',                       count(*)
  FROM orders o WHERE NOT EXISTS (SELECT 1 FROM order_items i WHERE i.order_id = o.id)
UNION ALL SELECT 'order without exactly one payment',         count(*)
  FROM (SELECT o.id FROM orders o LEFT JOIN payments p ON p.order_id = o.id
        GROUP BY o.id HAVING count(p.id) <> 1) x
UNION ALL SELECT 'order total <> sum of its lines',           count(*)
  FROM (SELECT o.id FROM orders o JOIN order_items i ON i.order_id = o.id
        GROUP BY o.id, o.total_cents HAVING sum(i.price_cents * i.qty) <> o.total_cents) x
UNION ALL SELECT 'payment amount <> order total',             count(*)
  FROM payments p JOIN orders o ON o.id = p.order_id WHERE p.amount_cents <> o.total_cents
UNION ALL SELECT 'shipping address belongs to another user',  count(*)
  FROM orders o JOIN addresses a ON a.id = o.address_id WHERE a.user_id <> o.user_id
UNION ALL SELECT 'order line qty <> 1 (one-of-one stock)',    count(*)
  FROM order_items WHERE qty <> 1
UNION ALL SELECT 'product sold on more than one order line',  count(*)
  FROM (SELECT product_id FROM order_items GROUP BY product_id HAVING count(*) > 1) x

-- ---- payment state vs order state ------------------------------------------
UNION ALL SELECT 'captured payment on unpaid order',          count(*)
  FROM payments p JOIN orders o ON o.id = p.order_id
 WHERE p.status = 'captured' AND o.status NOT IN ('paid','shipped','delivered','fulfilled')
UNION ALL SELECT 'paid-or-later order without a capture',     count(*)
  FROM payments p JOIN orders o ON o.id = p.order_id
 WHERE o.status IN ('paid','shipped','delivered','fulfilled') AND p.status <> 'captured'
UNION ALL SELECT 'refund on an order that was not cancelled', count(*)
  FROM payments p JOIN orders o ON o.id = p.order_id
 WHERE p.status = 'refunded' AND o.status <> 'cancelled'

-- ---- stock vs the order book ------------------------------------------------
UNION ALL SELECT 'product held/sold but still live',          count(*)
  FROM products pr WHERE EXISTS (
    SELECT 1 FROM order_items i JOIN orders o ON o.id = i.order_id
     WHERE i.product_id = pr.id AND o.status <> 'cancelled')
   AND (pr.status <> 'sold' OR pr.stock_quantity <> 0)
UNION ALL SELECT 'cancelled order did not release its stock', count(*)
  FROM products pr WHERE EXISTS (
    SELECT 1 FROM order_items i JOIN orders o ON o.id = i.order_id
     WHERE i.product_id = pr.id AND o.status = 'cancelled')
   AND NOT EXISTS (
    SELECT 1 FROM order_items i JOIN orders o ON o.id = i.order_id
     WHERE i.product_id = pr.id AND o.status <> 'cancelled')
   AND (pr.status <> 'live' OR pr.stock_quantity <> 1)
UNION ALL SELECT 'live product with zero stock',              count(*)
  FROM products WHERE status = 'live' AND stock_quantity <> 1
UNION ALL SELECT 'sold product with stock left',              count(*)
  FROM products WHERE status = 'sold' AND stock_quantity <> 0

-- ---- catalogue completeness -------------------------------------------------
UNION ALL SELECT 'product with no photo',                     count(*)
  FROM products pr WHERE NOT EXISTS (SELECT 1 FROM product_images im WHERE im.product_id = pr.id)
UNION ALL SELECT 'product with no size',                      count(*)
  FROM products pr WHERE NOT EXISTS (SELECT 1 FROM product_sizes s WHERE s.product_id = pr.id)
UNION ALL SELECT 'product priced above its original price',   count(*)
  FROM products WHERE original_price_cents IS NOT NULL AND price_cents >= original_price_cents
UNION ALL SELECT 'order line size not stocked by product',    count(*)
  FROM order_items i WHERE NOT EXISTS (
    SELECT 1 FROM product_sizes s WHERE s.product_id = i.product_id AND s.size = i.size)
UNION ALL SELECT 'cart line size not stocked by product',     count(*)
  FROM cart_items c WHERE NOT EXISTS (
    SELECT 1 FROM product_sizes s WHERE s.product_id = c.product_id AND s.size = c.size)
UNION ALL SELECT 'cart holds a product that is not live',     count(*)
  FROM cart_items c JOIN products p ON p.id = c.product_id WHERE p.status <> 'live'

-- ---- tracking history -------------------------------------------------------
UNION ALL SELECT 'shipped order without a dispatch event',    count(*)
  FROM orders o WHERE o.status IN ('shipped','delivered','fulfilled') AND NOT EXISTS (
    SELECT 1 FROM order_events e WHERE e.order_id = o.id AND e.label = 'Dispatched from our studio')
UNION ALL SELECT 'delivered order without a Delivered event', count(*)
  FROM orders o WHERE o.status IN ('delivered','fulfilled') AND NOT EXISTS (
    SELECT 1 FROM order_events e WHERE e.order_id = o.id AND e.label = 'Delivered')
UNION ALL SELECT 'cancelled order without a cancel event',    count(*)
  FROM orders o WHERE o.status = 'cancelled' AND NOT EXISTS (
    SELECT 1 FROM order_events e WHERE e.order_id = o.id AND e.label = 'Order cancelled')
UNION ALL SELECT 'captured order without payment event',      count(*)
  FROM orders o JOIN payments p ON p.order_id = o.id
 WHERE p.status = 'captured' AND NOT EXISTS (
    SELECT 1 FROM order_events e WHERE e.order_id = o.id AND e.label = 'Payment confirmed')
UNION ALL SELECT 'pending order with any tracking event',     count(*)
  FROM orders o WHERE o.status = 'pending_payment'
   AND EXISTS (SELECT 1 FROM order_events e WHERE e.order_id = o.id)
UNION ALL SELECT 'tracking event before its order',           count(*)
  FROM order_events e JOIN orders o ON o.id = e.order_id WHERE e.created_at < o.created_at
UNION ALL SELECT 'tracking event in the future',              count(*)
  FROM order_events WHERE created_at > (now() at time zone 'UTC')

-- ---- returns and reviews ----------------------------------------------------
UNION ALL SELECT 'return on a non-delivered order',           count(*)
  FROM returns r JOIN order_items i ON i.id = r.order_item_id JOIN orders o ON o.id = i.order_id
 WHERE o.status NOT IN ('delivered','fulfilled','shipped','paid')
UNION ALL SELECT 'return filed by someone else',              count(*)
  FROM returns r JOIN order_items i ON i.id = r.order_item_id JOIN orders o ON o.id = i.order_id
 WHERE r.user_id <> o.user_id
UNION ALL SELECT 'open return with a resolution date',        count(*)
  FROM returns WHERE status = 'requested' AND resolved_at IS NOT NULL
UNION ALL SELECT 'settled return with no resolution date',    count(*)
  FROM returns WHERE status <> 'requested' AND resolved_at IS NULL
UNION ALL SELECT 'return resolved before it was requested',   count(*)
  FROM returns WHERE resolved_at IS NOT NULL AND resolved_at < created_at
UNION ALL SELECT 'review from a non-buyer (demo accounts)',   count(*)
  FROM reviews rv JOIN users u ON u.id = rv.user_id
 WHERE u.email LIKE '%@vault-demo.test' AND NOT EXISTS (
    SELECT 1 FROM order_items i JOIN orders o ON o.id = i.order_id
     WHERE i.product_id = rv.product_id AND o.user_id = rv.user_id)
UNION ALL SELECT 'review rating out of range',                count(*)
  FROM reviews WHERE rating < 1 OR rating > 5

-- ---- nothing may be dated in the future ------------------------------------
-- Added after returns and reviews were found dated days ahead of now: both add
-- a delay to a delivery date, which lands in the future for a recent order.
UNION ALL SELECT 'return requested in the future',            count(*)
  FROM returns WHERE created_at > (now() at time zone 'UTC')
UNION ALL SELECT 'return resolved in the future',             count(*)
  FROM returns WHERE resolved_at > (now() at time zone 'UTC')
UNION ALL SELECT 'review written in the future',              count(*)
  FROM reviews WHERE created_at > (now() at time zone 'UTC')
UNION ALL SELECT 'review predates its delivery',              count(*)
  FROM reviews rv JOIN users u ON u.id = rv.user_id
  JOIN order_items i ON i.product_id = rv.product_id
  JOIN orders o ON o.id = i.order_id AND o.user_id = rv.user_id
 WHERE u.email LIKE '%@vault-demo.test' AND o.delivered_at IS NOT NULL
   AND rv.created_at < o.delivered_at
UNION ALL SELECT 'return filed before delivery',              count(*)
  FROM returns r JOIN order_items i ON i.id = r.order_item_id JOIN orders o ON o.id = i.order_id
 WHERE o.delivered_at IS NOT NULL AND r.created_at < o.delivered_at
UNION ALL SELECT 'payment dated in the future',               count(*)
  FROM payments WHERE created_at > (now() at time zone 'UTC')
UNION ALL SELECT 'account created in the future',             count(*)
  FROM users WHERE email LIKE '%@vault-demo.test' AND created_at > (now() at time zone 'UTC')
UNION ALL SELECT 'cart/wishlist dated in the future',         count(*)
  FROM (SELECT added_at FROM cart_items UNION ALL SELECT added_at FROM wishlist_items) x
 WHERE added_at > (now() at time zone 'UTC')
UNION ALL SELECT 'product listed in the future',              count(*)
  FROM products WHERE created_at > (now() at time zone 'UTC')

-- Timestamps are `timestamp without time zone` holding UTC, so every comparison
-- above converts now() to UTC first. Comparing against a bare now() in a
-- non-UTC session silently shifts each check by the offset — it read as passing
-- while ignoring anything less than that far in the future.
UNION ALL SELECT 'pending hold already lapsed (sweep will cancel)', count(*)
  FROM orders WHERE status = 'pending_payment'
   AND expires_at <= (now() at time zone 'UTC')
)
SELECT assertion, bad, CASE WHEN bad = 0 THEN 'pass' ELSE '*** FAIL ***' END AS result
FROM checks ORDER BY bad DESC, assertion;
