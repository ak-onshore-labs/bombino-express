-- Seed the pickup beats. GENERATED — do not edit by hand.
--
--     npx tsx scripts/generate-beat-seed.ts
--
-- Source of truth is `PICKUP_BEATS` in shared/pickupPincodes.ts, which stays
-- compiled into the app as the fallback for when this database is unreachable.
-- Editing this file instead of that one makes the two disagree, and the app
-- would then serve different coverage depending on whether Supabase answered.
--
-- 20 beats, 713 pincode rows.
--
-- Idempotent. Beats upsert on slug; each beat's pincodes are replaced wholesale
-- so a code removed upstream actually goes away. Runs in one transaction, so a
-- failure part-way leaves the previous coverage intact rather than a half-seeded
-- table that would quietly narrow what customers can book.
--
-- Agent membership (`pickup_beat_agents`) is never written here. Ops own it
-- from /ops/beats, and a re-seed must not undo their assignments.

BEGIN;

-- Kolkata — Kolkata, 101 pincodes, cutoff 15:00
-- Riders: none named by ops — a job here notifies every agent.
INSERT INTO public.pickup_beats (slug, name, hub, cutoff_hour)
VALUES ('kolkata', 'Kolkata', 'Kolkata', 15)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  hub = EXCLUDED.hub,
  cutoff_hour = EXCLUDED.cutoff_hour,
  updated_at = now();

DELETE FROM public.pickup_beat_pincodes
WHERE beat_id = (SELECT id FROM public.pickup_beats WHERE slug = 'kolkata');

INSERT INTO public.pickup_beat_pincodes (beat_id, pincode, city, area, remark)
SELECT b.id, v.pincode, v.city, v.area, v.remark
FROM public.pickup_beats b, (VALUES
  ('700001', 'Kolkata', 'DALHOUSIE', 'ok'),
  ('700002', 'Kolkata', 'COSSIPORE', 'out_of_city'),
  ('700003', 'Kolkata', 'BAG BAZAR', 'out_of_city'),
  ('700004', 'Kolkata', 'SHYAMBAZAR', 'ok'),
  ('700005', 'Kolkata', 'HATKOLA', 'out_of_city'),
  ('700006', 'Kolkata', 'BEADON STREET', 'ok'),
  ('700007', 'Kolkata', 'BARABAZAR', 'ok'),
  ('700008', 'Kolkata', 'BARISHA', 'out_of_city'),
  ('700009', 'Kolkata', 'RAJA RAMMOHAN ROY SARANI', 'ok'),
  ('700010', 'Kolkata', 'BELIAGHATA', 'ok'),
  ('700011', 'Kolkata', 'NARKELDANGA', 'ok'),
  ('700012', 'Kolkata', 'BOWBAZAR', 'ok'),
  ('700013', 'Kolkata', 'DHARMATALA', 'ok'),
  ('700014', 'Kolkata', 'ENTALLY', 'ok'),
  ('700015', 'Kolkata', 'TANGRA', 'ok'),
  ('700016', 'Kolkata', 'PARK STREET', 'ok'),
  ('700017', 'Kolkata', 'CIRCUS AVENUE', 'ok'),
  ('700018', 'Kolkata', 'BURTOLA', 'out_of_city'),
  ('700019', 'Kolkata', 'BALLYGUNGE', 'ok'),
  ('700020', 'Kolkata', 'ENGIN ROAD, MINTOO PARK', 'ok'),
  ('700021', 'Kolkata', 'FORT WILLIAM', 'ok'),
  ('700022', 'Kolkata', 'HASTINGS', 'ok'),
  ('700023', 'Kolkata', 'KHIDIRPUR', 'ok'),
  ('700024', 'Kolkata', 'GARDEN REACH', 'out_of_city'),
  ('700025', 'Kolkata', 'BHOWINIPORE', 'ok'),
  ('700026', 'Kolkata', 'KALIGHAT', 'ok'),
  ('700027', 'Kolkata', 'ALIPORE', 'ok'),
  ('700028', 'Kolkata', 'DAMDAM', 'out_of_city'),
  ('700029', 'Kolkata', 'SARAT BOSE ROAD', 'ok'),
  ('700030', 'Kolkata', 'GHUGHUDANGA', 'out_of_city'),
  ('700031', 'Kolkata', 'DHAKURIA', 'ok'),
  ('700032', 'Kolkata', 'JADAVPUR UNIVERSITY', 'ok'),
  ('700033', 'Kolkata', 'TOLLYGUNGE', 'ok'),
  ('700034', 'Kolkata', 'BEHALA', 'out_of_city'),
  ('700035', 'Kolkata', 'ALAMBAZAR', 'out_of_city'),
  ('700036', 'Kolkata', 'BARANAGAR', 'out_of_city'),
  ('700037', 'Kolkata', 'BELGACHIA', 'ok'),
  ('700038', 'Kolkata', 'SAHAPUR', 'ok'),
  ('700039', 'Kolkata', 'TILJALA', 'ok'),
  ('700040', 'Kolkata', 'REGENT PARK', 'ok'),
  ('700041', 'Kolkata', 'PASCHIM PUTIARY', 'out_of_city'),
  ('700042', 'Kolkata', 'KASBA', 'ok'),
  ('700043', 'Kolkata', 'S E RLY', 'ok'),
  ('700044', 'Kolkata', 'BADARTALA', 'out_of_city'),
  ('700045', 'Kolkata', 'LAKE GARDENS', 'ok'),
  ('700046', 'Kolkata', 'TOPSIA', 'ok'),
  ('700047', 'Kolkata', 'NAKTALA', 'out_of_city'),
  ('700048', 'Kolkata', 'SREE BHUMI', 'out_of_city'),
  ('700049', 'Kolkata', 'NIMTA', 'out_of_city'),
  ('700050', 'Kolkata', 'SINTHEE', 'ok'),
  ('700051', 'Kolkata', 'BIRATI', 'out_of_city'),
  ('700052', 'Kolkata', 'CAL. AIRPORT', 'out_of_city'),
  ('700053', 'Kolkata', 'NEW ALIPORE', 'ok'),
  ('700054', 'Kolkata', 'KANKURGACHI', 'ok'),
  ('700055', 'Kolkata', 'BANGUR AVENUE', 'ok'),
  ('700056', 'Kolkata', 'BELGARIA', 'ok'),
  ('700057', 'Kolkata', 'ARIADAHA', 'out_of_city'),
  ('700058', 'Kolkata', 'KAMARHATI', 'out_of_city'),
  ('700059', 'Kolkata', 'DESBANDHU NAGAR', 'out_of_city'),
  ('700060', 'Kolkata', 'PARNASREE PALLY', 'out_of_city'),
  ('700061', 'Kolkata', 'SARSUNA', 'out_of_city'),
  ('700063', 'Kolkata', 'THAKURPUR', 'ok'),
  ('700064', 'Kolkata', 'SALT LAKE', 'ok'),
  ('700065', 'Kolkata', 'RABINDRANAGAR', 'out_of_city'),
  ('700066', 'Kolkata', 'BIDHANGAR', 'ok'),
  ('700067', 'Kolkata', 'ULTADANGA', 'ok'),
  ('700068', 'Kolkata', 'JODHPUR PARK', 'ok'),
  ('700069', 'Kolkata', 'ESPLANADE', 'ok'),
  ('700070', 'Kolkata', 'BANSDRONI', 'out_of_city'),
  ('700071', 'Kolkata', 'CHOWRINGHEE', 'ok'),
  ('700072', 'Kolkata', 'PRINCEP STREET', 'ok'),
  ('700073', 'Kolkata', 'CHITTARANJAN AVENUE', 'ok'),
  ('700074', 'Kolkata', 'MOTIJHEEL', 'ok'),
  ('700075', 'Kolkata', 'SANTOSHPUR', 'ok'),
  ('700076', 'Kolkata', 'DAKSHINESWAR', 'out_of_city'),
  ('700077', 'Kolkata', 'BEDIAPARA', 'out_of_city'),
  ('700078', 'Kolkata', 'HALTU', 'out_of_city'),
  ('700079', 'Kolkata', 'ITALGACHHA', 'out_of_city'),
  ('700080', 'Kolkata', 'MALL ROAD', 'out_of_city'),
  ('700081', 'Kolkata', 'RAJBARI COLONY', 'out_of_city'),
  ('700082', 'Kolkata', 'HARIDEBPUR', 'out_of_city'),
  ('700083', 'Kolkata', 'NANDAN NAGAR', 'out_of_city'),
  ('700084', 'Kolkata', 'GARIA', 'out_of_city'),
  ('700085', 'Kolkata', 'PAIKPARA', 'out_of_city'),
  ('700086', 'Kolkata', 'BAGHAJATIN', 'ok'),
  ('700087', 'Kolkata', 'NEW MARKET', 'ok'),
  ('700088', 'Kolkata', 'BRACE BRIDGE', 'ok'),
  ('700089', 'Kolkata', 'LAKE TOWN', 'ok'),
  ('700090', 'Kolkata', 'NAWPARA', 'out_of_city'),
  ('700091', 'Kolkata', 'SECH BHAWAN', 'out_of_city'),
  ('700092', 'Kolkata', 'REGENT ESTATE', 'out_of_city'),
  ('700093', 'Kolkata', 'PURBA PUNTIARY', 'out_of_city'),
  ('700094', 'Kolkata', 'PANCHASAYAR', 'out_of_city'),
  ('700095', 'Kolkata', 'GOLG GREEN', 'ok'),
  ('700099', 'Kolkata', 'HIGHLAND PARK', 'out_of_city'),
  ('700100', 'Kolkata', 'VIP NAGAR', 'out_of_city'),
  ('700101', 'Kolkata', 'KESTOPUR', 'ok'),
  ('700102', 'Kolkata', 'BY PASS', 'ok'),
  ('700104', 'Kolkata', 'JOKA', 'out_of_city'),
  ('700105', 'Kolkata', 'SCIENCE CITY', 'ok'),
  ('700108', 'Kolkata', 'BON HOOGLY', 'out_of_city')
) AS v(pincode, city, area, remark)
WHERE b.slug = 'kolkata';

-- Delhi — Delhi, 97 pincodes, cutoff 17:00
-- Riders: Ranjeet Yadav, Puneet Verma, Ayan Khan
INSERT INTO public.pickup_beats (slug, name, hub, cutoff_hour)
VALUES ('delhi', 'Delhi', 'Delhi', 17)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  hub = EXCLUDED.hub,
  cutoff_hour = EXCLUDED.cutoff_hour,
  updated_at = now();

DELETE FROM public.pickup_beat_pincodes
WHERE beat_id = (SELECT id FROM public.pickup_beats WHERE slug = 'delhi');

INSERT INTO public.pickup_beat_pincodes (beat_id, pincode, city, area, remark)
SELECT b.id, v.pincode, v.city, v.area, v.remark
FROM public.pickup_beats b, (VALUES
  ('110079', 'Delhi', 'PATEL NAGAR', 'ok'),
  ('110047', 'Delhi', 'AYA NAGAR', 'ok'),
  ('110001', 'Delhi', 'CENTRAL DELHI', 'ok'),
  ('110030', 'Delhi', 'LADO SARAI', 'ok'),
  ('110070', 'Delhi', 'VASANT KUNJ', 'ok'),
  ('110072', 'Delhi', 'JHARODA KALAN', 'ok'),
  ('110051', 'Delhi', 'KRISHNA NAGAR', 'ok'),
  ('110075', 'Delhi', 'DWARKA SECTOR 6', 'ok'),
  ('110068', 'Delhi', 'NEB SARAI', 'ok'),
  ('110012', 'Delhi', 'INDER PURI', 'ok'),
  ('110028', 'Delhi', 'NARAINA', 'ok'),
  ('110021', 'Delhi', 'CHANAKYA PURI', 'ok'),
  ('110011', 'Delhi', 'SOUTH AVENUE', 'ok'),
  ('110016', 'Delhi', 'HAUSKHAS, GREEN PARK', 'ok'),
  ('110049', 'Delhi', 'GAUTAM NAGAR, GULMOHAR PARK', 'ok'),
  ('110024', 'Delhi', 'DEFENCE COLONY, LAJPAT NAGAR', 'ok'),
  ('110094', 'Delhi', 'GOKAL PURI, DAYAL PUR', 'ok'),
  ('110046', 'Delhi', 'SAGAR PUR', 'ok'),
  ('110058', 'Delhi', 'JANAK PURI', 'ok'),
  ('110061', 'Delhi', 'BIJWASAN', 'ok'),
  ('110050', 'Delhi', 'SAFDARJUNG', 'ok'),
  ('110019', 'Delhi', 'ALAKNANDA, CR PARK', 'ok'),
  ('110048', 'Delhi', 'GREATER KAILASH', 'ok'),
  ('110065', 'Delhi', 'EAST OF KAILASH, NEHRU NAGAR', 'ok'),
  ('110020', 'Delhi', 'OKHLA PHASE 1', 'ok'),
  ('110080', 'Delhi', 'SANGAM VIHAR', 'ok'),
  ('110017', 'Delhi', 'SAKET, PUSHP VIHAR', 'ok'),
  ('110043', 'Delhi', 'NAJAFGARH', 'ok'),
  ('110071', 'Delhi', 'CHHAWALA', 'ok'),
  ('110085', 'Delhi', 'ROHINI', 'ok'),
  ('110089', 'Delhi', 'SECTOR 15 ROHINI', 'ok'),
  ('110027', 'Delhi', 'RAJOURI GARDEN', 'ok'),
  ('110003', 'Delhi', 'LODHI ROAD, PRAGATI MAIDAN', 'ok'),
  ('110033', 'Delhi', 'JAHANGIR PURI, BHALASWA', 'ok'),
  ('110044', 'Delhi', 'BADAR PUR', 'ok'),
  ('110039', 'Delhi', 'AUCHANDI', 'ok'),
  ('110036', 'Delhi', 'ALI PUR', 'ok'),
  ('110093', 'Delhi', 'NAND NAGRI', 'ok'),
  ('110095', 'Delhi', 'VIVEK VIHAR, DILSHAD GARDEN', 'ok'),
  ('110009', 'Delhi', 'MODEL TOWN, VIJAY NAGAR', 'ok'),
  ('110054', 'Delhi', 'CIVIL LINES', 'ok'),
  ('110007', 'Delhi', 'RANA PRATAP BAGH', 'ok'),
  ('110053', 'Delhi', 'GHONDA, BHAJANPURA', 'ok'),
  ('110023', 'Delhi', 'KIDWAI NAGAR, LAXMIBAI NAGAR', 'ok'),
  ('110022', 'Delhi', 'R K PURAM', 'ok'),
  ('110037', 'Delhi', 'MAHIPALPUR', 'ok'),
  ('110038', 'Delhi', 'RAJOKRI', 'ok'),
  ('110078', 'Delhi', 'KAKROLA', 'ok'),
  ('110013', 'Delhi', 'HAZRAT NIZAMUDDIN', 'ok'),
  ('110014', 'Delhi', 'EEWAN NAGAR, JUNG PURA', 'ok'),
  ('110074', 'Delhi', 'CHANDAN HOLA', 'ok'),
  ('110025', 'Delhi', 'JAMIA, NEW FRIENDS COLONY', 'ok'),
  ('110057', 'Delhi', 'VASANT VIHAR', 'ok'),
  ('110062', 'Delhi', 'TUGLKABAD, DAKSHINPURI', 'ok'),
  ('110066', 'Delhi', 'R K PURAM', 'ok'),
  ('110067', 'Delhi', 'JNU, MUNIRKA', 'ok'),
  ('110076', 'Delhi', 'MADANPUR KHADAR, SARITA VIHAR', 'ok'),
  ('110035', 'Delhi', 'INDER LOK, KESHAV PURAM', 'ok'),
  ('110052', 'Delhi', 'ASHOK VIHAR', 'ok'),
  ('110084', 'Delhi', 'BURARI, JAGAT PUR', 'ok'),
  ('110045', 'Delhi', 'PALAM, INDRA PARK', 'ok'),
  ('110026', 'Delhi', 'PUNJABI BAGH', 'ok'),
  ('110063', 'Delhi', 'JWALA HERI, MADI PUR', 'ok'),
  ('110056', 'Delhi', 'SHAKUR BASTI', 'ok'),
  ('110082', 'Delhi', 'KHERA KALAN', 'ok'),
  ('110073', 'Delhi', 'DHANSA, MALIK PUR', 'ok'),
  ('110008', 'Delhi', 'PATEL NAGAR', 'ok'),
  ('110096', 'Delhi', 'KONDLI, NEW ASHOK NAGAR', 'ok'),
  ('110083', 'Delhi', 'MANGOL PURI', 'ok'),
  ('110064', 'Delhi', 'MAYA PURI, HARI NAGAR', 'ok'),
  ('110042', 'Delhi', 'BADLI, PEHLAD PUR', 'ok'),
  ('110029', 'Delhi', 'NOUROJI NAGAR, ANSARI NAGAR', 'ok'),
  ('110060', 'Delhi', 'RAJENDER NAGAR', 'ok'),
  ('110040', 'Delhi', 'NARELA', 'ok'),
  ('110077', 'Delhi', 'BAGROLA, BHARTHAL', 'ok'),
  ('110088', 'Delhi', 'SHALIMAR BAGH, HAIDER PUR', 'ok'),
  ('110041', 'Delhi', 'MUNDKA NANGLOI', 'ok'),
  ('110087', 'Delhi', 'SUNDER VIHAR', 'ok'),
  ('110031', 'Delhi', 'GANDHI NAGAR, GEETA COLONY', 'ok'),
  ('110092', 'Delhi', 'LAXMI NAGAR, ANAND VIHAR, MANDAWALI', 'ok'),
  ('110090', 'Delhi', 'SONIA VIHAR', 'ok'),
  ('110032', 'Delhi', 'BABAR PUR, VISHWAS NAGAR', 'ok'),
  ('110091', 'Delhi', 'KALYAN PURI, HILLA VILLAGE', 'ok'),
  ('110015', 'Delhi', 'BAKKAR WALA, CHAUKHANDI', 'ok'),
  ('110018', 'Delhi', 'ASHOK NAGAR, FATEH NAGAR', 'ok'),
  ('110006', 'Delhi', 'CHAWRI BAZAR, CHANDNI CHOWK', 'ok'),
  ('110005', 'Delhi', 'KAROL BAGH', 'ok'),
  ('110002', 'Delhi', 'AJMERI GATE, DARYAGANJ', 'ok'),
  ('110034', 'Delhi', 'MAURYA ENCLAVE, RANI BAGH', 'ok'),
  ('110010', 'Delhi', 'DELHI CANTT', 'ok'),
  ('110055', 'Delhi', 'PAHAR GANJ', 'ok'),
  ('110069', 'Delhi', 'CENTRAL DELHI', 'ok'),
  ('110004', 'Delhi', 'RASHTRAPATI BHAWAN', 'ok'),
  ('110081', 'Delhi', 'CHAND PUR, JAUNTI', 'ok'),
  ('110059', 'Delhi', 'MOHAN GARDEN', 'ok'),
  ('110086', 'Delhi', 'BEGAM PUR, BUDH VIHAR', 'ok'),
  ('110097', 'Delhi', 'KAPASHERA', 'ok')
) AS v(pincode, city, area, remark)
WHERE b.slug = 'delhi';

-- Girgaum to Tardeo and Nepean Sea Road — Fort, 7 pincodes, cutoff 19:00
-- Riders: Mohd. Sagir, Wasim Sayyed
INSERT INTO public.pickup_beats (slug, name, hub, cutoff_hour)
VALUES ('mumbai-fort-girgaum-tardeo', 'Girgaum to Tardeo and Nepean Sea Road', 'Fort', 19)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  hub = EXCLUDED.hub,
  cutoff_hour = EXCLUDED.cutoff_hour,
  updated_at = now();

DELETE FROM public.pickup_beat_pincodes
WHERE beat_id = (SELECT id FROM public.pickup_beats WHERE slug = 'mumbai-fort-girgaum-tardeo');

INSERT INTO public.pickup_beat_pincodes (beat_id, pincode, city, area, remark)
SELECT b.id, v.pincode, v.city, v.area, v.remark
FROM public.pickup_beats b, (VALUES
  ('400004', 'Mumbai', 'Fort', 'ok'),
  ('400006', 'Mumbai', 'Fort', 'ok'),
  ('400007', 'Mumbai', 'Fort', 'ok'),
  ('400008', 'Mumbai', 'Fort', 'ok'),
  ('400026', 'Mumbai', 'Fort', 'ok'),
  ('400034', 'Mumbai', 'Fort', 'ok'),
  ('400036', 'Mumbai', 'Fort', 'ok')
) AS v(pincode, city, area, remark)
WHERE b.slug = 'mumbai-fort-girgaum-tardeo';

-- Kalbadevi to Mazgaon and Churchgate — Fort, 6 pincodes, cutoff 19:00
-- Riders: Siddharth Thorat, Wasim Sayyed
INSERT INTO public.pickup_beats (slug, name, hub, cutoff_hour)
VALUES ('mumbai-fort-kalbadevi-mazgaon', 'Kalbadevi to Mazgaon and Churchgate', 'Fort', 19)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  hub = EXCLUDED.hub,
  cutoff_hour = EXCLUDED.cutoff_hour,
  updated_at = now();

DELETE FROM public.pickup_beat_pincodes
WHERE beat_id = (SELECT id FROM public.pickup_beats WHERE slug = 'mumbai-fort-kalbadevi-mazgaon');

INSERT INTO public.pickup_beat_pincodes (beat_id, pincode, city, area, remark)
SELECT b.id, v.pincode, v.city, v.area, v.remark
FROM public.pickup_beats b, (VALUES
  ('400002', 'Mumbai', 'Fort', 'ok'),
  ('400003', 'Mumbai', 'Fort', 'ok'),
  ('400008', 'Mumbai', 'Fort', 'ok'),
  ('400009', 'Mumbai', 'Fort', 'ok'),
  ('400010', 'Mumbai', 'Fort', 'ok'),
  ('400020', 'Mumbai', 'Fort', 'ok')
) AS v(pincode, city, area, remark)
WHERE b.slug = 'mumbai-fort-kalbadevi-mazgaon';

-- Fort, Colaba, Nariman Point and Ballard Estate — Fort, 6 pincodes, cutoff 19:00
-- Riders: Suresh Bhangre, Wasim Sayyed
INSERT INTO public.pickup_beats (slug, name, hub, cutoff_hour)
VALUES ('mumbai-fort-colaba-ballard', 'Fort, Colaba, Nariman Point and Ballard Estate', 'Fort', 19)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  hub = EXCLUDED.hub,
  cutoff_hour = EXCLUDED.cutoff_hour,
  updated_at = now();

DELETE FROM public.pickup_beat_pincodes
WHERE beat_id = (SELECT id FROM public.pickup_beats WHERE slug = 'mumbai-fort-colaba-ballard');

INSERT INTO public.pickup_beat_pincodes (beat_id, pincode, city, area, remark)
SELECT b.id, v.pincode, v.city, v.area, v.remark
FROM public.pickup_beats b, (VALUES
  ('400001', 'Mumbai', 'Fort', 'ok'),
  ('400005', 'Mumbai', 'Fort', 'ok'),
  ('400021', 'Mumbai', 'Fort', 'ok'),
  ('400023', 'Mumbai', 'Fort', 'ok'),
  ('400038', 'Mumbai', 'Fort', 'ok'),
  ('400039', 'Mumbai', 'Fort', 'ok')
) AS v(pincode, city, area, remark)
WHERE b.slug = 'mumbai-fort-colaba-ballard';

-- Hyderabad — Hyderabad, 89 pincodes, cutoff 15:00
-- Riders: Mohammed Sohail Khan
INSERT INTO public.pickup_beats (slug, name, hub, cutoff_hour)
VALUES ('hyderabad', 'Hyderabad', 'Hyderabad', 15)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  hub = EXCLUDED.hub,
  cutoff_hour = EXCLUDED.cutoff_hour,
  updated_at = now();

DELETE FROM public.pickup_beat_pincodes
WHERE beat_id = (SELECT id FROM public.pickup_beats WHERE slug = 'hyderabad');

INSERT INTO public.pickup_beat_pincodes (beat_id, pincode, city, area, remark)
SELECT b.id, v.pincode, v.city, v.area, v.remark
FROM public.pickup_beats b, (VALUES
  ('500001', 'Hyderabad', 'Hyderabad', 'ok'),
  ('500002', 'Hyderabad', 'Hyderabad', 'ok'),
  ('500003', 'Hyderabad', 'Hyderabad', 'ok'),
  ('500004', 'Hyderabad', 'Hyderabad', 'ok'),
  ('500005', 'Hyderabad', 'Hyderabad', 'ok'),
  ('500006', 'Hyderabad', 'Hyderabad', 'ok'),
  ('500007', 'Hyderabad', 'Hyderabad', 'ok'),
  ('500008', 'Hyderabad', 'Hyderabad', 'ok'),
  ('500009', 'Hyderabad', 'Hyderabad', 'ok'),
  ('500010', 'Hyderabad', 'Hyderabad', 'ok'),
  ('500011', 'Hyderabad', 'Hyderabad', 'ok'),
  ('500012', 'Hyderabad', 'Hyderabad', 'ok'),
  ('500013', 'Hyderabad', 'Hyderabad', 'ok'),
  ('500014', 'Hyderabad', 'Hyderabad', 'ok'),
  ('500015', 'Hyderabad', 'Hyderabad', 'ok'),
  ('500016', 'Hyderabad', 'Hyderabad', 'ok'),
  ('500017', 'Hyderabad', 'Hyderabad', 'ok'),
  ('500018', 'Hyderabad', 'Hyderabad', 'ok'),
  ('500019', 'Hyderabad', 'Hyderabad', 'ok'),
  ('500020', 'Hyderabad', 'Hyderabad', 'ok'),
  ('500021', 'Hyderabad', 'Hyderabad', 'ok'),
  ('500022', 'Hyderabad', 'Hyderabad', 'ok'),
  ('500023', 'Hyderabad', 'Hyderabad', 'ok'),
  ('500024', 'Hyderabad', 'Hyderabad', 'ok'),
  ('500025', 'Hyderabad', 'Hyderabad', 'ok'),
  ('500026', 'Hyderabad', 'Hyderabad', 'ok'),
  ('500027', 'Hyderabad', 'Hyderabad', 'ok'),
  ('500028', 'Hyderabad', 'Hyderabad', 'ok'),
  ('500029', 'Hyderabad', 'Hyderabad', 'ok'),
  ('500030', 'Hyderabad', 'Hyderabad', 'ok'),
  ('500031', 'Hyderabad', 'Hyderabad', 'ok'),
  ('500032', 'Hyderabad', 'Hyderabad', 'ok'),
  ('500033', 'Hyderabad', 'Hyderabad', 'ok'),
  ('500034', 'Hyderabad', 'Hyderabad', 'ok'),
  ('500035', 'Hyderabad', 'Hyderabad', 'ok'),
  ('500036', 'Hyderabad', 'Hyderabad', 'ok'),
  ('500037', 'Hyderabad', 'Hyderabad', 'ok'),
  ('500038', 'Hyderabad', 'Hyderabad', 'ok'),
  ('500039', 'Hyderabad', 'Hyderabad', 'ok'),
  ('500040', 'Hyderabad', 'Hyderabad', 'ok'),
  ('500041', 'Hyderabad', 'Hyderabad', 'ok'),
  ('500042', 'Hyderabad', 'Hyderabad', 'ok'),
  ('500043', 'Hyderabad', 'Hyderabad', 'ok'),
  ('500044', 'Hyderabad', 'Hyderabad', 'ok'),
  ('500045', 'Hyderabad', 'Hyderabad', 'ok'),
  ('500046', 'Hyderabad', 'Hyderabad', 'ok'),
  ('500047', 'Hyderabad', 'Hyderabad', 'ok'),
  ('500048', 'Hyderabad', 'Hyderabad', 'ok'),
  ('500049', 'Hyderabad', 'Hyderabad', 'ok'),
  ('500050', 'Hyderabad', 'Hyderabad', 'ok'),
  ('500051', 'Hyderabad', 'Hyderabad', 'ok'),
  ('500052', 'Hyderabad', 'Hyderabad', 'ok'),
  ('500053', 'Hyderabad', 'Hyderabad', 'ok'),
  ('500054', 'Hyderabad', 'Hyderabad', 'ok'),
  ('500055', 'Hyderabad', 'Hyderabad', 'ok'),
  ('500056', 'Hyderabad', 'Hyderabad', 'ok'),
  ('500057', 'Hyderabad', 'Hyderabad', 'ok'),
  ('500058', 'Hyderabad', 'Hyderabad', 'ok'),
  ('500059', 'Hyderabad', 'Hyderabad', 'ok'),
  ('500060', 'Hyderabad', 'Hyderabad', 'ok'),
  ('500061', 'Hyderabad', 'Hyderabad', 'ok'),
  ('500062', 'Hyderabad', 'Hyderabad', 'ok'),
  ('500063', 'Hyderabad', 'Hyderabad', 'ok'),
  ('500064', 'Hyderabad', 'Hyderabad', 'ok'),
  ('500065', 'Hyderabad', 'Hyderabad', 'ok'),
  ('500066', 'Hyderabad', 'Hyderabad', 'ok'),
  ('500067', 'Hyderabad', 'Hyderabad', 'ok'),
  ('500068', 'Hyderabad', 'Hyderabad', 'ok'),
  ('500069', 'Hyderabad', 'Hyderabad', 'ok'),
  ('500070', 'Hyderabad', 'Hyderabad', 'ok'),
  ('500071', 'Hyderabad', 'Hyderabad', 'ok'),
  ('500072', 'Hyderabad', 'Hyderabad', 'ok'),
  ('500073', 'Hyderabad', 'Hyderabad', 'ok'),
  ('500074', 'Hyderabad', 'Hyderabad', 'ok'),
  ('500075', 'Hyderabad', 'Hyderabad', 'ok'),
  ('500076', 'Hyderabad', 'Hyderabad', 'ok'),
  ('500077', 'Hyderabad', 'Hyderabad', 'ok'),
  ('500078', 'Hyderabad', 'Hyderabad', 'ok'),
  ('500079', 'Hyderabad', 'Hyderabad', 'ok'),
  ('500080', 'Hyderabad', 'Hyderabad', 'ok'),
  ('500081', 'Hyderabad', 'Hyderabad', 'ok'),
  ('500082', 'Hyderabad', 'Hyderabad', 'ok'),
  ('500083', 'Hyderabad', 'Hyderabad', 'ok'),
  ('500084', 'Hyderabad', 'Hyderabad', 'ok'),
  ('500085', 'Hyderabad', 'Hyderabad', 'ok'),
  ('500086', 'Hyderabad', 'Hyderabad', 'ok'),
  ('500087', 'Hyderabad', 'Hyderabad', 'ok'),
  ('500088', 'Hyderabad', 'Hyderabad', 'ok'),
  ('500089', 'Hyderabad', 'Hyderabad', 'ok')
) AS v(pincode, city, area, remark)
WHERE b.slug = 'hyderabad';

-- All Surat — Surat, 17 pincodes, cutoff 17:00
-- Riders: Ganjawala Sajid, Arif Bhai
INSERT INTO public.pickup_beats (slug, name, hub, cutoff_hour)
VALUES ('surat', 'All Surat', 'Surat', 17)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  hub = EXCLUDED.hub,
  cutoff_hour = EXCLUDED.cutoff_hour,
  updated_at = now();

DELETE FROM public.pickup_beat_pincodes
WHERE beat_id = (SELECT id FROM public.pickup_beats WHERE slug = 'surat');

INSERT INTO public.pickup_beat_pincodes (beat_id, pincode, city, area, remark)
SELECT b.id, v.pincode, v.city, v.area, v.remark
FROM public.pickup_beats b, (VALUES
  ('394210', 'Surat', 'Surat', 'ok'),
  ('394221', 'Surat', 'Surat', 'ok'),
  ('395001', 'Surat', 'Surat', 'ok'),
  ('395002', 'Surat', 'Surat', 'ok'),
  ('395003', 'Surat', 'Surat', 'ok'),
  ('395004', 'Surat', 'Surat', 'ok'),
  ('395005', 'Surat', 'Surat', 'ok'),
  ('395006', 'Surat', 'Surat', 'ok'),
  ('395007', 'Surat', 'Surat', 'ok'),
  ('395008', 'Surat', 'Surat', 'ok'),
  ('395009', 'Surat', 'Surat', 'ok'),
  ('395010', 'Surat', 'Surat', 'ok'),
  ('395011', 'Surat', 'Surat', 'ok'),
  ('395012', 'Surat', 'Surat', 'ok'),
  ('395013', 'Surat', 'Surat', 'ok'),
  ('395017', 'Surat', 'Surat', 'ok'),
  ('395023', 'Surat', 'Surat', 'ok')
) AS v(pincode, city, area, remark)
WHERE b.slug = 'surat';

-- All Pune — Pune, 53 pincodes, cutoff 17:00
-- Riders: Sohail Khan, Ayan Shaikh
INSERT INTO public.pickup_beats (slug, name, hub, cutoff_hour)
VALUES ('pune', 'All Pune', 'Pune', 17)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  hub = EXCLUDED.hub,
  cutoff_hour = EXCLUDED.cutoff_hour,
  updated_at = now();

DELETE FROM public.pickup_beat_pincodes
WHERE beat_id = (SELECT id FROM public.pickup_beats WHERE slug = 'pune');

INSERT INTO public.pickup_beat_pincodes (beat_id, pincode, city, area, remark)
SELECT b.id, v.pincode, v.city, v.area, v.remark
FROM public.pickup_beats b, (VALUES
  ('411001', 'Pune', 'Pune', 'ok'),
  ('411002', 'Pune', 'Pune', 'ok'),
  ('411003', 'Pune', 'Pune', 'ok'),
  ('411004', 'Pune', 'Pune', 'ok'),
  ('411005', 'Pune', 'Pune', 'ok'),
  ('411006', 'Pune', 'Pune', 'ok'),
  ('411007', 'Pune', 'Pune', 'ok'),
  ('411008', 'Pune', 'Pune', 'ok'),
  ('411009', 'Pune', 'Pune', 'ok'),
  ('411011', 'Pune', 'Pune', 'ok'),
  ('411012', 'Pune', 'Pune', 'ok'),
  ('411013', 'Pune', 'Pune', 'ok'),
  ('411014', 'Pune', 'Pune', 'ok'),
  ('411015', 'Pune', 'Pune', 'ok'),
  ('411016', 'Pune', 'Pune', 'ok'),
  ('411017', 'Pune', 'Pune', 'ok'),
  ('411018', 'Pune', 'Pune', 'ok'),
  ('411019', 'Pune', 'Pune', 'ok'),
  ('411020', 'Pune', 'Pune', 'ok'),
  ('411021', 'Pune', 'Pune', 'ok'),
  ('411022', 'Pune', 'Pune', 'ok'),
  ('411023', 'Pune', 'Pune', 'ok'),
  ('411024', 'Pune', 'Pune', 'ok'),
  ('411025', 'Pune', 'Pune', 'ok'),
  ('411026', 'Pune', 'Pune', 'ok'),
  ('411027', 'Pune', 'Pune', 'ok'),
  ('411028', 'Pune', 'Pune', 'ok'),
  ('411030', 'Pune', 'Pune', 'ok'),
  ('411031', 'Pune', 'Pune', 'ok'),
  ('411032', 'Pune', 'Pune', 'ok'),
  ('411033', 'Pune', 'Pune', 'ok'),
  ('411034', 'Pune', 'Pune', 'ok'),
  ('411035', 'Pune', 'Pune', 'ok'),
  ('411036', 'Pune', 'Pune', 'ok'),
  ('411037', 'Pune', 'Pune', 'ok'),
  ('411038', 'Pune', 'Pune', 'ok'),
  ('411039', 'Pune', 'Pune', 'ok'),
  ('411040', 'Pune', 'Pune', 'ok'),
  ('411041', 'Pune', 'Pune', 'ok'),
  ('411042', 'Pune', 'Pune', 'ok'),
  ('411043', 'Pune', 'Pune', 'ok'),
  ('411044', 'Pune', 'Pune', 'ok'),
  ('411045', 'Pune', 'Pune', 'ok'),
  ('411046', 'Pune', 'Pune', 'ok'),
  ('411047', 'Pune', 'Pune', 'ok'),
  ('411048', 'Pune', 'Pune', 'ok'),
  ('411051', 'Pune', 'Pune', 'ok'),
  ('411052', 'Pune', 'Pune', 'ok'),
  ('411057', 'Pune', 'Pune', 'ok'),
  ('411058', 'Pune', 'Pune', 'ok'),
  ('411060', 'Pune', 'Pune', 'ok'),
  ('411061', 'Pune', 'Pune', 'ok'),
  ('411062', 'Pune', 'Pune', 'ok')
) AS v(pincode, city, area, remark)
WHERE b.slug = 'pune';

-- All Chennai — Chennai, 120 pincodes, cutoff 17:00
-- Riders: Deva Kumar
INSERT INTO public.pickup_beats (slug, name, hub, cutoff_hour)
VALUES ('chennai', 'All Chennai', 'Chennai', 17)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  hub = EXCLUDED.hub,
  cutoff_hour = EXCLUDED.cutoff_hour,
  updated_at = now();

DELETE FROM public.pickup_beat_pincodes
WHERE beat_id = (SELECT id FROM public.pickup_beats WHERE slug = 'chennai');

INSERT INTO public.pickup_beat_pincodes (beat_id, pincode, city, area, remark)
SELECT b.id, v.pincode, v.city, v.area, v.remark
FROM public.pickup_beats b, (VALUES
  ('600001', 'Chennai', 'Chennai', 'ok'),
  ('600002', 'Chennai', 'Chennai', 'ok'),
  ('600003', 'Chennai', 'Chennai', 'ok'),
  ('600004', 'Chennai', 'Chennai', 'ok'),
  ('600005', 'Chennai', 'Chennai', 'ok'),
  ('600006', 'Chennai', 'Chennai', 'ok'),
  ('600007', 'Chennai', 'Chennai', 'ok'),
  ('600008', 'Chennai', 'Chennai', 'ok'),
  ('600009', 'Chennai', 'Chennai', 'ok'),
  ('600010', 'Chennai', 'Chennai', 'ok'),
  ('600011', 'Chennai', 'Chennai', 'ok'),
  ('600012', 'Chennai', 'Chennai', 'ok'),
  ('600013', 'Chennai', 'Chennai', 'ok'),
  ('600014', 'Chennai', 'Chennai', 'ok'),
  ('600015', 'Chennai', 'Chennai', 'ok'),
  ('600016', 'Chennai', 'Chennai', 'ok'),
  ('600017', 'Chennai', 'Chennai', 'ok'),
  ('600018', 'Chennai', 'Chennai', 'ok'),
  ('600019', 'Chennai', 'Chennai', 'ok'),
  ('600020', 'Chennai', 'Chennai', 'ok'),
  ('600021', 'Chennai', 'Chennai', 'ok'),
  ('600022', 'Chennai', 'Chennai', 'ok'),
  ('600023', 'Chennai', 'Chennai', 'ok'),
  ('600024', 'Chennai', 'Chennai', 'ok'),
  ('600025', 'Chennai', 'Chennai', 'ok'),
  ('600026', 'Chennai', 'Chennai', 'ok'),
  ('600028', 'Chennai', 'Chennai', 'ok'),
  ('600029', 'Chennai', 'Chennai', 'ok'),
  ('600030', 'Chennai', 'Chennai', 'ok'),
  ('600031', 'Chennai', 'Chennai', 'ok'),
  ('600032', 'Chennai', 'Chennai', 'ok'),
  ('600033', 'Chennai', 'Chennai', 'ok'),
  ('600034', 'Chennai', 'Chennai', 'ok'),
  ('600035', 'Chennai', 'Chennai', 'ok'),
  ('600036', 'Chennai', 'Chennai', 'ok'),
  ('600037', 'Chennai', 'Chennai', 'ok'),
  ('600038', 'Chennai', 'Chennai', 'ok'),
  ('600039', 'Chennai', 'Chennai', 'ok'),
  ('600040', 'Chennai', 'Chennai', 'ok'),
  ('600041', 'Chennai', 'Chennai', 'ok'),
  ('600042', 'Chennai', 'Chennai', 'ok'),
  ('600043', 'Chennai', 'Chennai', 'ok'),
  ('600044', 'Chennai', 'Chennai', 'ok'),
  ('600045', 'Chennai', 'Chennai', 'ok'),
  ('600046', 'Chennai', 'Chennai', 'ok'),
  ('600047', 'Chennai', 'Chennai', 'ok'),
  ('600048', 'Chennai', 'Chennai', 'ok'),
  ('600049', 'Chennai', 'Chennai', 'ok'),
  ('600050', 'Chennai', 'Chennai', 'ok'),
  ('600051', 'Chennai', 'Chennai', 'ok'),
  ('600052', 'Chennai', 'Chennai', 'ok'),
  ('600053', 'Chennai', 'Chennai', 'ok'),
  ('600054', 'Chennai', 'Chennai', 'ok'),
  ('600055', 'Chennai', 'Chennai', 'ok'),
  ('600056', 'Chennai', 'Chennai', 'ok'),
  ('600057', 'Chennai', 'Chennai', 'ok'),
  ('600058', 'Chennai', 'Chennai', 'ok'),
  ('600059', 'Chennai', 'Chennai', 'ok'),
  ('600060', 'Chennai', 'Chennai', 'ok'),
  ('600061', 'Chennai', 'Chennai', 'ok'),
  ('600062', 'Chennai', 'Chennai', 'ok'),
  ('600063', 'Chennai', 'Chennai', 'ok'),
  ('600064', 'Chennai', 'Chennai', 'ok'),
  ('600065', 'Chennai', 'Chennai', 'ok'),
  ('600066', 'Chennai', 'Chennai', 'ok'),
  ('600067', 'Chennai', 'Chennai', 'ok'),
  ('600068', 'Chennai', 'Chennai', 'ok'),
  ('600069', 'Chennai', 'Chennai', 'ok'),
  ('600070', 'Chennai', 'Chennai', 'ok'),
  ('600071', 'Chennai', 'Chennai', 'ok'),
  ('600072', 'Chennai', 'Chennai', 'ok'),
  ('600073', 'Chennai', 'Chennai', 'ok'),
  ('600074', 'Chennai', 'Chennai', 'ok'),
  ('600075', 'Chennai', 'Chennai', 'ok'),
  ('600076', 'Chennai', 'Chennai', 'ok'),
  ('600077', 'Chennai', 'Chennai', 'ok'),
  ('600078', 'Chennai', 'Chennai', 'ok'),
  ('600081', 'Chennai', 'Chennai', 'ok'),
  ('600082', 'Chennai', 'Chennai', 'ok'),
  ('600083', 'Chennai', 'Chennai', 'ok'),
  ('600084', 'Chennai', 'Chennai', 'ok'),
  ('600085', 'Chennai', 'Chennai', 'ok'),
  ('600086', 'Chennai', 'Chennai', 'ok'),
  ('600087', 'Chennai', 'Chennai', 'ok'),
  ('600088', 'Chennai', 'Chennai', 'ok'),
  ('600089', 'Chennai', 'Chennai', 'ok'),
  ('600090', 'Chennai', 'Chennai', 'ok'),
  ('600091', 'Chennai', 'Chennai', 'ok'),
  ('600092', 'Chennai', 'Chennai', 'ok'),
  ('600093', 'Chennai', 'Chennai', 'ok'),
  ('600094', 'Chennai', 'Chennai', 'ok'),
  ('600095', 'Chennai', 'Chennai', 'ok'),
  ('600096', 'Chennai', 'Chennai', 'ok'),
  ('600097', 'Chennai', 'Chennai', 'ok'),
  ('600098', 'Chennai', 'Chennai', 'ok'),
  ('600099', 'Chennai', 'Chennai', 'ok'),
  ('600100', 'Chennai', 'Chennai', 'ok'),
  ('600101', 'Chennai', 'Chennai', 'ok'),
  ('600102', 'Chennai', 'Chennai', 'ok'),
  ('600103', 'Chennai', 'Chennai', 'ok'),
  ('600104', 'Chennai', 'Chennai', 'ok'),
  ('600106', 'Chennai', 'Chennai', 'ok'),
  ('600107', 'Chennai', 'Chennai', 'ok'),
  ('600110', 'Chennai', 'Chennai', 'ok'),
  ('600113', 'Chennai', 'Chennai', 'ok'),
  ('600115', 'Chennai', 'Chennai', 'ok'),
  ('600116', 'Chennai', 'Chennai', 'ok'),
  ('600117', 'Chennai', 'Chennai', 'ok'),
  ('600118', 'Chennai', 'Chennai', 'ok'),
  ('600119', 'Chennai', 'Chennai', 'ok'),
  ('600120', 'Chennai', 'Chennai', 'ok'),
  ('600122', 'Chennai', 'Chennai', 'ok'),
  ('600123', 'Chennai', 'Chennai', 'ok'),
  ('600124', 'Chennai', 'Chennai', 'ok'),
  ('600125', 'Chennai', 'Chennai', 'ok'),
  ('600126', 'Chennai', 'Chennai', 'ok'),
  ('600127', 'Chennai', 'Chennai', 'ok'),
  ('600128', 'Chennai', 'Chennai', 'ok'),
  ('600129', 'Chennai', 'Chennai', 'ok'),
  ('600130', 'Chennai', 'Chennai', 'ok')
) AS v(pincode, city, area, remark)
WHERE b.slug = 'chennai';

-- All Ahmedabad — Ahmedabad, 51 pincodes, cutoff 17:00
-- Riders: Saiyed Tahir
INSERT INTO public.pickup_beats (slug, name, hub, cutoff_hour)
VALUES ('ahmedabad', 'All Ahmedabad', 'Ahmedabad', 17)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  hub = EXCLUDED.hub,
  cutoff_hour = EXCLUDED.cutoff_hour,
  updated_at = now();

DELETE FROM public.pickup_beat_pincodes
WHERE beat_id = (SELECT id FROM public.pickup_beats WHERE slug = 'ahmedabad');

INSERT INTO public.pickup_beat_pincodes (beat_id, pincode, city, area, remark)
SELECT b.id, v.pincode, v.city, v.area, v.remark
FROM public.pickup_beats b, (VALUES
  ('380001', 'Ahmedabad', 'Ahmedabad', 'ok'),
  ('380002', 'Ahmedabad', 'Ahmedabad', 'ok'),
  ('380004', 'Ahmedabad', 'Ahmedabad', 'ok'),
  ('380005', 'Ahmedabad', 'Ahmedabad', 'ok'),
  ('380006', 'Ahmedabad', 'Ahmedabad', 'ok'),
  ('380007', 'Ahmedabad', 'Ahmedabad', 'ok'),
  ('380008', 'Ahmedabad', 'Ahmedabad', 'ok'),
  ('380009', 'Ahmedabad', 'Ahmedabad', 'ok'),
  ('380013', 'Ahmedabad', 'Ahmedabad', 'ok'),
  ('380014', 'Ahmedabad', 'Ahmedabad', 'ok'),
  ('380015', 'Ahmedabad', 'Ahmedabad', 'ok'),
  ('380016', 'Ahmedabad', 'Ahmedabad', 'ok'),
  ('380018', 'Ahmedabad', 'Ahmedabad', 'ok'),
  ('380019', 'Ahmedabad', 'Ahmedabad', 'ok'),
  ('380021', 'Ahmedabad', 'Ahmedabad', 'ok'),
  ('380022', 'Ahmedabad', 'Ahmedabad', 'ok'),
  ('380023', 'Ahmedabad', 'Ahmedabad', 'ok'),
  ('380024', 'Ahmedabad', 'Ahmedabad', 'ok'),
  ('380026', 'Ahmedabad', 'Ahmedabad', 'ok'),
  ('380027', 'Ahmedabad', 'Ahmedabad', 'ok'),
  ('380028', 'Ahmedabad', 'Ahmedabad', 'ok'),
  ('380050', 'Ahmedabad', 'Ahmedabad', 'ok'),
  ('380051', 'Ahmedabad', 'Ahmedabad', 'ok'),
  ('380052', 'Ahmedabad', 'Ahmedabad', 'ok'),
  ('380054', 'Ahmedabad', 'Ahmedabad', 'ok'),
  ('380055', 'Ahmedabad', 'Ahmedabad', 'ok'),
  ('380058', 'Ahmedabad', 'Ahmedabad', 'ok'),
  ('380059', 'Ahmedabad', 'Ahmedabad', 'ok'),
  ('380060', 'Ahmedabad', 'Ahmedabad', 'ok'),
  ('380061', 'Ahmedabad', 'Ahmedabad', 'ok'),
  ('380063', 'Ahmedabad', 'Ahmedabad', 'ok'),
  ('382330', 'Ahmedabad', 'Ahmedabad', 'ok'),
  ('382340', 'Ahmedabad', 'Ahmedabad', 'ok'),
  ('382345', 'Ahmedabad', 'Ahmedabad', 'ok'),
  ('382350', 'Ahmedabad', 'Ahmedabad', 'ok'),
  ('382405', 'Ahmedabad', 'Ahmedabad', 'ok'),
  ('382415', 'Ahmedabad', 'Ahmedabad', 'ok'),
  ('382418', 'Ahmedabad', 'Ahmedabad', 'ok'),
  ('382425', 'Ahmedabad', 'Ahmedabad', 'ok'),
  ('382427', 'Ahmedabad', 'Ahmedabad', 'ok'),
  ('382430', 'Ahmedabad', 'Ahmedabad', 'ok'),
  ('382433', 'Ahmedabad', 'Ahmedabad', 'ok'),
  ('382435', 'Ahmedabad', 'Ahmedabad', 'ok'),
  ('382440', 'Ahmedabad', 'Ahmedabad', 'ok'),
  ('382443', 'Ahmedabad', 'Ahmedabad', 'ok'),
  ('382445', 'Ahmedabad', 'Ahmedabad', 'ok'),
  ('382449', 'Ahmedabad', 'Ahmedabad', 'ok'),
  ('382470', 'Ahmedabad', 'Ahmedabad', 'ok'),
  ('382475', 'Ahmedabad', 'Ahmedabad', 'ok'),
  ('382480', 'Ahmedabad', 'Ahmedabad', 'ok'),
  ('382481', 'Ahmedabad', 'Ahmedabad', 'ok')
) AS v(pincode, city, area, remark)
WHERE b.slug = 'ahmedabad';

-- All Jaipur — Jaipur, 69 pincodes, cutoff 17:00
-- Riders: Javed
INSERT INTO public.pickup_beats (slug, name, hub, cutoff_hour)
VALUES ('jaipur', 'All Jaipur', 'Jaipur', 17)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  hub = EXCLUDED.hub,
  cutoff_hour = EXCLUDED.cutoff_hour,
  updated_at = now();

DELETE FROM public.pickup_beat_pincodes
WHERE beat_id = (SELECT id FROM public.pickup_beats WHERE slug = 'jaipur');

INSERT INTO public.pickup_beat_pincodes (beat_id, pincode, city, area, remark)
SELECT b.id, v.pincode, v.city, v.area, v.remark
FROM public.pickup_beats b, (VALUES
  ('302001', 'Jaipur', 'Jaipur GPO', 'ok'),
  ('302002', 'Jaipur', 'Amer Road', 'ok'),
  ('302003', 'Jaipur', 'Jaipur City', 'ok'),
  ('302004', 'Jaipur', 'Jawahar Nagar HO', 'ok'),
  ('302005', 'Jaipur', 'N.C.R. Building', 'ok'),
  ('302006', 'Jaipur', 'Ajmer Road', 'ok'),
  ('302012', 'Jaipur', 'Jhotwara', 'ok'),
  ('302013', 'Jaipur', 'Harmada', 'ok'),
  ('302015', 'Jaipur', 'Gandhi Nagar', 'ok'),
  ('302016', 'Jaipur', 'Shastri Nagar HO', 'ok'),
  ('302017', 'Jaipur', 'Jagatpura', 'ok'),
  ('302018', 'Jaipur', 'Amer Clark Hotel', 'ok'),
  ('302019', 'Jaipur', 'Shyam Nagar', 'ok'),
  ('302020', 'Jaipur', 'Kaveri Path Mansarovar', 'ok'),
  ('302021', 'Jaipur', 'Vaishali Nagar', 'ok'),
  ('302022', 'Jaipur', 'Sitapura Industrial Area', 'ok'),
  ('302025', 'Jaipur', 'Jagatpura', 'ok'),
  ('302026', 'Jaipur', 'Bhankrota', 'ok'),
  ('302027', 'Jaipur', 'Jaisinghpura Khore', 'ok'),
  ('302028', 'Jaipur', 'Amer', 'ok'),
  ('302029', 'Jaipur', 'Airport Sanganer', 'ok'),
  ('302031', 'Jaipur', 'Jamdoli', 'ok'),
  ('302033', 'Jaipur', 'Pratap Nagar Housing Board', 'ok'),
  ('302034', 'Jaipur', 'Panchyawala', 'ok'),
  ('302037', 'Jaipur', 'Mahindra World City', 'ok'),
  ('302038', 'Jaipur', 'Kookas', 'ok'),
  ('302039', 'Jaipur', 'Amba Bari', 'ok'),
  ('302041', 'Jaipur', 'Bindayaka', 'ok'),
  ('303001', 'Jaipur', 'Andhi', 'ok'),
  ('303002', 'Jaipur', 'Achrol', 'ok'),
  ('303003', 'Jaipur', 'Talba Bihajar', 'ok'),
  ('303004', 'Jaipur', 'Lawain', 'ok'),
  ('303005', 'Jaipur', 'Phagi', 'ok'),
  ('303006', 'Jaipur', 'Madhorajpura', 'ok'),
  ('303007', 'Jaipur', 'Ajairajpura', 'ok'),
  ('303008', 'Jaipur', 'Sirohi Kalan', 'ok'),
  ('303009', 'Jaipur', 'Sanwali', 'ok'),
  ('303102', 'Jaipur', 'Sothana', 'ok'),
  ('303103', 'Jaipur', 'Badi Jori', 'ok'),
  ('303104', 'Jaipur', 'Sirohi', 'ok'),
  ('303105', 'Jaipur', 'Suklawas', 'ok'),
  ('303106', 'Jaipur', 'Paota', 'ok'),
  ('303107', 'Jaipur', 'Suderpura Dhadha', 'ok'),
  ('303108', 'Jaipur', 'Sunderpura', 'ok'),
  ('303119', 'Jaipur', 'Antela', 'ok'),
  ('303120', 'Jaipur', 'Amloda', 'ok'),
  ('303123', 'Jaipur', 'Bhainsawa', 'ok'),
  ('303302', 'Jaipur', 'Anantpura', 'ok'),
  ('303305', 'Jaipur', 'Badwa', 'ok'),
  ('303329', 'Jaipur', 'A C Jobner', 'ok'),
  ('303338', 'Jaipur', 'Akoda', 'ok'),
  ('303348', 'Jaipur', 'Srirampura', 'ok'),
  ('303509', 'Jaipur', 'Udaipuria', 'ok'),
  ('303601', 'Jaipur', 'Amarsar', 'ok'),
  ('303602', 'Jaipur', 'Badhal', 'ok'),
  ('303603', 'Jaipur', 'Bagawas', 'ok'),
  ('303604', 'Jaipur', 'Asalpur', 'ok'),
  ('303701', 'Jaipur', 'Chatarpura', 'ok'),
  ('303702', 'Jaipur', 'Sirsali', 'ok'),
  ('303704', 'Jaipur', 'Anantpura', 'ok'),
  ('303706', 'Jaipur', 'Bhamori', 'ok'),
  ('303712', 'Jaipur', 'Anantpura', 'ok'),
  ('303801', 'Jaipur', 'Alisar', 'ok'),
  ('303804', 'Jaipur', 'Amarpura', 'ok'),
  ('303805', 'Jaipur', 'Bagwara', 'ok'),
  ('303901', 'Jaipur', 'Akodiya', 'ok'),
  ('303903', 'Jaipur', 'Badapadampura', 'ok'),
  ('303904', 'Jaipur', 'Panwalia', 'ok'),
  ('303908', 'Jaipur', 'Achalpura', 'ok')
) AS v(pincode, city, area, remark)
WHERE b.slug = 'jaipur';

-- Jogeshwari → Borivali E/W — Mumbai (Andheri), 19 pincodes, cutoff 19:00
-- Riders: Shyam Kahar — named by ops, NO PHONE NUMBER, so no
-- account exists and a job here still notifies every agent.
INSERT INTO public.pickup_beats (slug, name, hub, cutoff_hour)
VALUES ('andheri-jogeshwari-borivali', 'Jogeshwari → Borivali E/W', 'Mumbai (Andheri)', 19)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  hub = EXCLUDED.hub,
  cutoff_hour = EXCLUDED.cutoff_hour,
  updated_at = now();

DELETE FROM public.pickup_beat_pincodes
WHERE beat_id = (SELECT id FROM public.pickup_beats WHERE slug = 'andheri-jogeshwari-borivali');

INSERT INTO public.pickup_beat_pincodes (beat_id, pincode, city, area, remark)
SELECT b.id, v.pincode, v.city, v.area, v.remark
FROM public.pickup_beats b, (VALUES
  ('400053', 'Mumbai', 'Andheri / Azad Nagar', 'ok'),
  ('400058', 'Mumbai', 'Andheri Railway Station', 'ok'),
  ('400060', 'Mumbai', 'Jogeshwari East / Meghwadi / Majas / Mogra', 'ok'),
  ('400061', 'Mumbai', 'Versova / Vesava', 'ok'),
  ('400062', 'Mumbai', 'Goregaon West', 'ok'),
  ('400063', 'Mumbai', 'Goregaon East', 'ok'),
  ('400064', 'Mumbai', 'Malad / Malad West', 'ok'),
  ('400065', 'Mumbai', 'Aarey Milk Colony', 'ok'),
  ('400066', 'Mumbai', 'Borivali East', 'ok'),
  ('400067', 'Mumbai', 'Kandivali West / Charkop', 'ok'),
  ('400090', 'Mumbai', 'Bangur Nagar', 'ok'),
  ('400091', 'Mumbai', 'Borivali HPO', 'ok'),
  ('400092', 'Mumbai', 'Borivali West', 'ok'),
  ('400095', 'Mumbai', 'Kharodi', 'ok'),
  ('400097', 'Mumbai', 'Malad East', 'ok'),
  ('400101', 'Mumbai', 'Kandivali East', 'ok'),
  ('400102', 'Mumbai', 'Jogeshwari West', 'ok'),
  ('400103', 'Mumbai', 'Mandapeshwar', 'ok'),
  ('400104', 'Mumbai', 'Motilal Nagar', 'ok')
) AS v(pincode, city, area, remark)
WHERE b.slug = 'andheri-jogeshwari-borivali';

-- Jogeshwari → Kandivali E/W — Mumbai (Andheri), 10 pincodes, cutoff 19:00
-- Riders: Kishore Shethi — named by ops, NO PHONE NUMBER, so no
-- account exists and a job here still notifies every agent.
INSERT INTO public.pickup_beats (slug, name, hub, cutoff_hour)
VALUES ('andheri-jogeshwari-kandivali', 'Jogeshwari → Kandivali E/W', 'Mumbai (Andheri)', 19)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  hub = EXCLUDED.hub,
  cutoff_hour = EXCLUDED.cutoff_hour,
  updated_at = now();

DELETE FROM public.pickup_beat_pincodes
WHERE beat_id = (SELECT id FROM public.pickup_beats WHERE slug = 'andheri-jogeshwari-kandivali');

INSERT INTO public.pickup_beat_pincodes (beat_id, pincode, city, area, remark)
SELECT b.id, v.pincode, v.city, v.area, v.remark
FROM public.pickup_beats b, (VALUES
  ('400060', 'Mumbai', 'Jogeshwari East / Meghwadi / Majas / Mogra', 'ok'),
  ('400062', 'Mumbai', 'Goregaon West', 'ok'),
  ('400063', 'Mumbai', 'Goregaon East', 'ok'),
  ('400064', 'Mumbai', 'Malad / Malad West', 'ok'),
  ('400065', 'Mumbai', 'Aarey Milk Colony', 'ok'),
  ('400067', 'Mumbai', 'Kandivali West / Charkop', 'ok'),
  ('400095', 'Mumbai', 'Kharodi', 'ok'),
  ('400097', 'Mumbai', 'Malad East', 'ok'),
  ('400101', 'Mumbai', 'Kandivali East', 'ok'),
  ('400102', 'Mumbai', 'Jogeshwari West', 'ok')
) AS v(pincode, city, area, remark)
WHERE b.slug = 'andheri-jogeshwari-kandivali';

-- Andheri East → Powai — Mumbai (Andheri), 14 pincodes, cutoff 19:00
-- Riders: Yogesh Singh, Rafiq Shaikh — named by ops, NO PHONE NUMBER, so no
-- account exists and a job here still notifies every agent.
INSERT INTO public.pickup_beats (slug, name, hub, cutoff_hour)
VALUES ('andheri-east-powai', 'Andheri East → Powai', 'Mumbai (Andheri)', 19)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  hub = EXCLUDED.hub,
  cutoff_hour = EXCLUDED.cutoff_hour,
  updated_at = now();

DELETE FROM public.pickup_beat_pincodes
WHERE beat_id = (SELECT id FROM public.pickup_beats WHERE slug = 'andheri-east-powai');

INSERT INTO public.pickup_beat_pincodes (beat_id, pincode, city, area, remark)
SELECT b.id, v.pincode, v.city, v.area, v.remark
FROM public.pickup_beats b, (VALUES
  ('400059', 'Mumbai', 'J.B. Nagar / J.B. Nagar area', 'ok'),
  ('400069', 'Mumbai', 'Andheri East', 'ok'),
  ('400072', 'Mumbai', 'Sakinaka', 'ok'),
  ('400076', 'Mumbai', 'Powai / IIT', 'ok'),
  ('400078', 'Mumbai', 'Bhandup West', 'ok'),
  ('400079', 'Mumbai', 'Vikhroli', 'ok'),
  ('400080', 'Mumbai', 'Mulund West', 'ok'),
  ('400081', 'Mumbai', 'Mulund East', 'ok'),
  ('400083', 'Mumbai', 'Tagore Nagar', 'ok'),
  ('400085', 'Mumbai', 'BARC', 'ok'),
  ('400087', 'Mumbai', 'NITIE / IIM area', 'ok'),
  ('400093', 'Mumbai', 'Chakala MIDC', 'ok'),
  ('400096', 'Mumbai', 'SEEPZ', 'ok'),
  ('400099', 'Mumbai', 'Sahar / Airport area', 'ok')
) AS v(pincode, city, area, remark)
WHERE b.slug = 'andheri-east-powai';

-- Andheri West → Vile Parle E/W + Juhu — Mumbai (Andheri), 6 pincodes, cutoff 19:00
-- Riders: Abrar Farooki — named by ops, NO PHONE NUMBER, so no
-- account exists and a job here still notifies every agent.
INSERT INTO public.pickup_beats (slug, name, hub, cutoff_hour)
VALUES ('andheri-west-vile-parle-juhu', 'Andheri West → Vile Parle E/W + Juhu', 'Mumbai (Andheri)', 19)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  hub = EXCLUDED.hub,
  cutoff_hour = EXCLUDED.cutoff_hour,
  updated_at = now();

DELETE FROM public.pickup_beat_pincodes
WHERE beat_id = (SELECT id FROM public.pickup_beats WHERE slug = 'andheri-west-vile-parle-juhu');

INSERT INTO public.pickup_beat_pincodes (beat_id, pincode, city, area, remark)
SELECT b.id, v.pincode, v.city, v.area, v.remark
FROM public.pickup_beats b, (VALUES
  ('400049', 'Mumbai', 'Juhu', 'ok'),
  ('400053', 'Mumbai', 'Andheri / Azad Nagar', 'ok'),
  ('400056', 'Mumbai', 'Vile Parle West', 'ok'),
  ('400057', 'Mumbai', 'Vile Parle East', 'ok'),
  ('400058', 'Mumbai', 'Andheri Railway Station', 'ok'),
  ('400061', 'Mumbai', 'Versova / Vesava', 'ok')
) AS v(pincode, city, area, remark)
WHERE b.slug = 'andheri-west-vile-parle-juhu';

-- Vile Parle → Bandra E/W — Mumbai (Andheri), 8 pincodes, cutoff 19:00
-- Riders: Sanjay Lawate — named by ops, NO PHONE NUMBER, so no
-- account exists and a job here still notifies every agent.
INSERT INTO public.pickup_beats (slug, name, hub, cutoff_hour)
VALUES ('andheri-vile-parle-bandra', 'Vile Parle → Bandra E/W', 'Mumbai (Andheri)', 19)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  hub = EXCLUDED.hub,
  cutoff_hour = EXCLUDED.cutoff_hour,
  updated_at = now();

DELETE FROM public.pickup_beat_pincodes
WHERE beat_id = (SELECT id FROM public.pickup_beats WHERE slug = 'andheri-vile-parle-bandra');

INSERT INTO public.pickup_beat_pincodes (beat_id, pincode, city, area, remark)
SELECT b.id, v.pincode, v.city, v.area, v.remark
FROM public.pickup_beats b, (VALUES
  ('400029', 'Mumbai', 'Santacruz P&T Colony', 'ok'),
  ('400050', 'Mumbai', 'Bandra West', 'ok'),
  ('400051', 'Mumbai', 'Bandra East', 'ok'),
  ('400052', 'Mumbai', 'Khar / Khar West', 'ok'),
  ('400054', 'Mumbai', 'Santacruz West', 'ok'),
  ('400055', 'Mumbai', 'Santacruz East', 'ok'),
  ('400056', 'Mumbai', 'Vile Parle West', 'ok'),
  ('400057', 'Mumbai', 'Vile Parle East', 'ok')
) AS v(pincode, city, area, remark)
WHERE b.slug = 'andheri-vile-parle-bandra';

-- Andheri West → Bandra E/W — Mumbai (Andheri), 10 pincodes, cutoff 19:00
-- Riders: Shahid Khan — named by ops, NO PHONE NUMBER, so no
-- account exists and a job here still notifies every agent.
INSERT INTO public.pickup_beats (slug, name, hub, cutoff_hour)
VALUES ('andheri-west-bandra', 'Andheri West → Bandra E/W', 'Mumbai (Andheri)', 19)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  hub = EXCLUDED.hub,
  cutoff_hour = EXCLUDED.cutoff_hour,
  updated_at = now();

DELETE FROM public.pickup_beat_pincodes
WHERE beat_id = (SELECT id FROM public.pickup_beats WHERE slug = 'andheri-west-bandra');

INSERT INTO public.pickup_beat_pincodes (beat_id, pincode, city, area, remark)
SELECT b.id, v.pincode, v.city, v.area, v.remark
FROM public.pickup_beats b, (VALUES
  ('400049', 'Mumbai', 'Juhu', 'ok'),
  ('400050', 'Mumbai', 'Bandra West', 'ok'),
  ('400051', 'Mumbai', 'Bandra East', 'ok'),
  ('400052', 'Mumbai', 'Khar / Khar West', 'ok'),
  ('400053', 'Mumbai', 'Andheri / Azad Nagar', 'ok'),
  ('400054', 'Mumbai', 'Santacruz West', 'ok'),
  ('400055', 'Mumbai', 'Santacruz East', 'ok'),
  ('400056', 'Mumbai', 'Vile Parle West', 'ok'),
  ('400057', 'Mumbai', 'Vile Parle East', 'ok'),
  ('400058', 'Mumbai', 'Andheri Railway Station', 'ok')
) AS v(pincode, city, area, remark)
WHERE b.slug = 'andheri-west-bandra';

-- Chembur → Ghatkopar / Kurla / Vashi — Mumbai (Andheri), 10 pincodes, cutoff 19:00
-- Riders: Rupesh Yadav — named by ops, NO PHONE NUMBER, so no
-- account exists and a job here still notifies every agent.
INSERT INTO public.pickup_beats (slug, name, hub, cutoff_hour)
VALUES ('andheri-chembur-ghatkopar-vashi', 'Chembur → Ghatkopar / Kurla / Vashi', 'Mumbai (Andheri)', 19)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  hub = EXCLUDED.hub,
  cutoff_hour = EXCLUDED.cutoff_hour,
  updated_at = now();

DELETE FROM public.pickup_beat_pincodes
WHERE beat_id = (SELECT id FROM public.pickup_beats WHERE slug = 'andheri-chembur-ghatkopar-vashi');

INSERT INTO public.pickup_beat_pincodes (beat_id, pincode, city, area, remark)
SELECT b.id, v.pincode, v.city, v.area, v.remark
FROM public.pickup_beats b, (VALUES
  ('400070', 'Mumbai', 'Kurla', 'ok'),
  ('400071', 'Mumbai', 'Chembur', 'ok'),
  ('400072', 'Mumbai', 'Sakinaka', 'ok'),
  ('400074', 'Mumbai', 'FCI', 'ok'),
  ('400075', 'Mumbai', 'Pant Nagar', 'ok'),
  ('400077', 'Mumbai', 'Rajawadi', 'ok'),
  ('400086', 'Mumbai', 'Ghatkopar West', 'ok'),
  ('400089', 'Mumbai', 'Tilak Nagar', 'ok'),
  ('400094', 'Mumbai', 'Anushakti Nagar', 'ok'),
  ('400703', 'Navi Mumbai', 'Vashi / Vashi Sec-26 / Turbhe', 'ok')
) AS v(pincode, city, area, remark)
WHERE b.slug = 'andheri-chembur-ghatkopar-vashi';

-- Ghatkopar → Thane E/W + Kurla/Chembur/Vashi/Airoli/ — Mumbai (Andheri), 13 pincodes, cutoff 19:00
-- Riders: Sameer Khan — named by ops, NO PHONE NUMBER, so no
-- account exists and a job here still notifies every agent.
INSERT INTO public.pickup_beats (slug, name, hub, cutoff_hour)
VALUES ('andheri-ghatkopar-thane-kurla', 'Ghatkopar → Thane E/W + Kurla/Chembur/Vashi/Airoli/', 'Mumbai (Andheri)', 19)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  hub = EXCLUDED.hub,
  cutoff_hour = EXCLUDED.cutoff_hour,
  updated_at = now();

DELETE FROM public.pickup_beat_pincodes
WHERE beat_id = (SELECT id FROM public.pickup_beats WHERE slug = 'andheri-ghatkopar-thane-kurla');

INSERT INTO public.pickup_beat_pincodes (beat_id, pincode, city, area, remark)
SELECT b.id, v.pincode, v.city, v.area, v.remark
FROM public.pickup_beats b, (VALUES
  ('400070', 'Mumbai', 'Kurla', 'ok'),
  ('400071', 'Mumbai', 'Chembur', 'ok'),
  ('400077', 'Mumbai', 'Rajawadi', 'ok'),
  ('400086', 'Mumbai', 'Ghatkopar West', 'ok'),
  ('400601', 'Thane', 'Thane / Thane HO', 'ok'),
  ('400602', 'Thane', 'Naupada', 'ok'),
  ('400603', 'Thane', 'Thane East / Kopri Colony', 'ok'),
  ('400604', 'Thane', 'Wagle Estate', 'ok'),
  ('400606', 'Thane', 'Jekegram', 'ok'),
  ('400607', 'Thane', 'Chitalsar Manpada', 'ok'),
  ('400703', 'Navi Mumbai', 'Vashi / Turbhe', 'ok'),
  ('400708', 'Navi Mumbai', 'Airoli', 'ok'),
  ('400710', 'Navi Mumbai', 'Millennium Business Park', 'ok')
) AS v(pincode, city, area, remark)
WHERE b.slug = 'andheri-ghatkopar-thane-kurla';

-- Ghatkopar → Thane E/W + Vashi/Airoli — Mumbai (Andheri), 7 pincodes, cutoff 19:00
-- Riders: Abrar Shaikh — named by ops, NO PHONE NUMBER, so no
-- account exists and a job here still notifies every agent.
INSERT INTO public.pickup_beats (slug, name, hub, cutoff_hour)
VALUES ('andheri-ghatkopar-thane-vashi', 'Ghatkopar → Thane E/W + Vashi/Airoli', 'Mumbai (Andheri)', 19)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  hub = EXCLUDED.hub,
  cutoff_hour = EXCLUDED.cutoff_hour,
  updated_at = now();

DELETE FROM public.pickup_beat_pincodes
WHERE beat_id = (SELECT id FROM public.pickup_beats WHERE slug = 'andheri-ghatkopar-thane-vashi');

INSERT INTO public.pickup_beat_pincodes (beat_id, pincode, city, area, remark)
SELECT b.id, v.pincode, v.city, v.area, v.remark
FROM public.pickup_beats b, (VALUES
  ('400077', 'Mumbai', 'Rajawadi', 'ok'),
  ('400086', 'Mumbai', 'Ghatkopar West', 'ok'),
  ('400601', 'Thane', 'Thane / Thane HO', 'ok'),
  ('400602', 'Thane', 'Naupada', 'ok'),
  ('400603', 'Thane', 'Thane East / Kopri Colony', 'ok'),
  ('400703', 'Navi Mumbai', 'Vashi / Turbhe', 'ok'),
  ('400708', 'Navi Mumbai', 'Airoli', 'ok')
) AS v(pincode, city, area, remark)
WHERE b.slug = 'andheri-ghatkopar-thane-vashi';

-- Beats this file no longer defines. Retired rather than deleted, so their
-- rows and any ops assignments survive and the change is one tap to undo.
-- mumbai-fort: superseded 8 Sep by the three real Fort rounds, whose union is identical
UPDATE public.pickup_beats SET is_active = false, updated_at = now()
WHERE slug = 'mumbai-fort' AND is_active;

COMMIT;
