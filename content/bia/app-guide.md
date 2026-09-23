# BIA app guide

What BIA reads when a customer asks how to do something in the app, where
something is, or what a feature does (`get_app_help`, server/supportAppGuide.ts).
BIA only guides: it never does anything for the customer. Everything here is
what the customer does themselves, on which screen, with which button.

**Keep this true.** When a screen or a feature changes, change its section in
the same pull request. When a new customer-facing feature ships, add a section.
BIA re-reads this file every minute, so an edit is live without a restart
(the deploy must ship the `content/` folder).

Format, per section:

- `## Title`: what the section is about, in the customer's words.
- `Asked as:` comma-separated ways a customer might ask. Matching is on these
  words and the title, so add the words people actually use.
- `Buttons:` optional. BIA button tokens to offer with the answer (the same
  vocabulary as shared/biaCta.ts; one a customer can't use is dropped).
- The rest is the answer: short, plain steps from the customer's side.

Getting around, for reference: on a phone the tabs at the bottom are **Home**,
**Rates**, **Ship** and **Orders**; the menu (☰, top left) has **My Profile**,
**Sign In** or **Sign Out**, **WhatsApp Support**, **Call Support** and
**Ask BIA**; the bell (top right) is **Notifications**. On a computer the same
places are in the sidebar on the left.

## Signing in
Asked as: log in, login, sign in, signin, OTP, one-time code, verification code, didn't get the code, code not received, resend code, password, can't log in

Open the menu (☰) and tap **Sign In**. Enter your 10-digit mobile number and tap **Send OTP**. The code arrives on WhatsApp. Enter the 6-digit code and tap **Verify & Sign In**. No code after a minute? Tap **Resend OTP**, and check WhatsApp on the phone that has this number. If you have shipped with Bombino before with an email and password, choose that on the sign-in screen and sign in once with them; your mobile number is then linked, and you use the code from then on.

## Opening an account
Asked as: sign up, signup, register, create account, open account, new account, company account, business account, personal account, which account, corporate, co-courier, e-commerce, ecommerce, FBB, contract, application, account being set up, account pending, account approved, waiting for my account, withdraw application

You can book without an account, as a guest. To open one: open the menu (☰), tap **Sign In** and verify your mobile number with the code; a number that has no account yet is asked **Have you shipped with Bombino before?** Tap **No, I'm new here**, then choose the account type (Personal for yourself; for a business: Corporate, Co-Courier, E-commerce or FBB), fill in your details, enter your identity numbers and upload the document that carries each, then review your details and sign the contract. Not sure which type? Ask me what you ship and I'll suggest one. Anything you booked as a guest with the same number moves into the account.

If the screen then says **Application sent**, the Bombino team sets the account up for you. Until it's ready you're a guest on the same number and can book as usual; **My Profile** shows where it stands. If the team asks for a change, the note and what to change are there, and **Make the change** reopens signup filled in. When it's ready you get an email with your login details, and you sign in again with your mobile number. You can **Withdraw application** from **My Profile** while it's open.

## Booking a shipment
Asked as: book, ship, send a parcel, create shipment, new shipment, how to ship, booking form, steps, place an order
Buttons: TAP_CREATE_SHIPMENT

Tap **Ship** at the bottom (**Create Shipment** on a computer). You go through the steps: your own details and whether we pick the parcel up from your door (choose a date) or you drop it at a Bombino counter; the receiver; the parcel's weight, pieces, packing and value; then the service, what's inside and its invoice details; and finally review and pay. On every step, **Ask BIA about this step** at the top explains what that step needs. You get an Order ID (BOM-…) as soon as you book.

## Booking as a guest, and your guest profile
Asked as: guest, without account, no account, guest profile, my details, save my details, guest booking, book without signing up
Buttons: TAP_GUEST_PROFILE

No account needed: in **Ship**, verify your mobile number with a code and book. Your bookings are filed against that number. Open the menu (☰) and tap **My Profile** to see your guest profile: your details, what's still missing, and your orders. **Add my details** saves your name, address and company once, so the next booking is mostly filled in. When everything's in, **Open my account** takes you to signup with what you already gave. **Sign out of this device** forgets the number on this phone; nothing is deleted.

## Checking prices
Asked as: rates, price, cost, how much, quote, calculator, rate card, price breakdown, fuel surcharge, charges

Tap **Rates** at the bottom. Enter where it's going from (your pincode), the destination country and its postal code, and the weight and number of pieces, then **Get Rates**. You see each service with its price; **View price breakdown** shows the base rate, fuel surcharge and other charges. It's an estimate: the final price is set when we weigh the parcel at our hub. Some routes say **Online booking not available**; for those, contact our team. Or tell me the destination and weight and I'll quote it here.

## Your orders and shipments
Asked as: my orders, my shipments, order list, find my order, orders tab, history, past orders, export, download, csv, spreadsheet, share list
Buttons: TAP_MY_ORDERS

Tap **Orders** at the bottom (**My Orders** on a computer). Every booking is listed, newest first; tap any row for its details. The box at the top tracks any AWB. Signed in, **Export CSV** downloads your shipments as a spreadsheet you can share. The **Cancellations** tab lists cancellation requests you've made and orders our team has cancelled. Booked as a guest? Your bookings also show on your guest profile.

## An order's page
Asked as: order page, order details, order status, timeline, pickup code, drop-off code, handover code, new code, pay now, call the rider, call agent, order information
Buttons: TAP_MY_ORDERS

Open **Orders** and tap the order. At the top: the Order ID, its status and, once issued, the tracking number (AWB). If a pickup or drop-off is due, the **pickup code** or **drop-off code** is shown there: read it out to the rider, or at the counter. If it was entered wrongly too many times, tap **Get a new code**. Below: the timeline, the rider (with a call button while they're on the way), the parcel, the receiver, and **Payment**, where a pay-online order that isn't paid yet has a **Pay** button. At the bottom: **Request cancellation**, while it's still allowed (for a pickup, until the rider sets out; for a drop-off, until you hand the parcel in), and **Questions about this order?**, which opens me already asking about it. Guests don't have an order page: your orders are on your guest profile, and the code comes on WhatsApp.

## Tracking a shipment
Asked as: track, tracking, where is my parcel, AWB, tracking number, incoming, receive, shipment status, delivery status, track a parcel sent to me

Once your parcel has a tracking number (AWB), enter it in **Track Any Order** on **Home**, in the box at the top of **Orders**, or on **Track** (on a computer, in the sidebar). It shows the status and every scan. On the shipment's page, the refresh button gets the latest scans and the copy button copies the AWB. Signed in, **Track & Receive** also lists shipments coming to you. Before the AWB is issued, your order shows in **Orders** under its Order ID. Or give me the AWB and I'll track it here.

## Shipping labels and invoice
Asked as: label, shipping label, postal label, box label, invoice, print, download label, commercial invoice

Open the shipment's page (from **Orders**, or by tracking its AWB). Once the shipment has them, buttons at the bottom download the **Box Label**, the **Postal Label** and the **Invoice** as PDFs you can print or share. They appear after the tracking number (AWB) is issued, since that's when the shipment is registered.

## Notifications
Asked as: notifications, bell, alerts, updates, messages in the app, notification, unread

Tap the bell at the top right. You'll find updates on your orders, and reminders from me. Tapping a shipment update opens its tracking; tapping one marked **Ask BIA** opens me already asking about it. An unread one has a dot; opening it marks it read. You also get order updates on WhatsApp.

## Reminders from BIA
Asked as: reminders, nudges, BIA reminders, stop reminders, turn off reminders, why did BIA message me

Now and then I write to your notifications when something of yours needs you: the amount changed after weighing, a pickup is tomorrow, a signup you started is waiting, or (for a guest) how an account could keep your shipments together. At most one a day, only about your own things, never an offer. To switch any kind off, open the menu (☰), tap **My Profile**, and use the switches under **Reminders from BIA**.

## Your profile and account details
Asked as: profile, my profile, account details, change username, edit username, change phone number, change mobile number, new number, unlink number, email, account settings, sign out, log out, logout

Open the menu (☰) and tap **My Profile** (**My Profile** in the sidebar on a computer). There you can edit your username, change your mobile number (**Change number**: we send a code to the new number, and an account that signs in with a password asks for it too), see your identity document and your account documents, switch reminders on or off, and reach support. To sign out, tap **Sign Out** in the menu, or at the bottom of your profile.

## Documents and your identity document
Asked as: documents, upload document, replace document, aadhaar, PAN, passport, driving licence, GST certificate, identity document, KYC, verify account, document rejected, clearer photo, reupload
Buttons: TAP_ACCOUNT_DOCUMENTS

I can't upload or change documents; you do it yourself, where you first gave them. With an account: open **My Profile**. **Finish verifying your account** lists the documents still to upload, and **Identity document** lets you replace the one on file. Opening an account: upload them on signup's documents step. Booking as a guest: add your identity document on the first step of the booking form (**Add my identity document** on your guest profile takes you there). If an upload says there's a problem, the message under it says what to do. Your shipments carry on either way.

## Drop-off counters
Asked as: drop off, drop-off, counter, branch, hub, office, address, where to drop, nearest counter, locations
Buttons: TAP_LOCATIONS

Bombino counters are listed on **Locations**. Tell me your pincode or city and I'll find the nearest, or tap the button to see them all. At the counter, show the drop-off code from your order, or, as a guest, your Order ID.

## Cancelling a booking
Asked as: cancel, cancellation, cancel order, cancel booking, cancellation status, refund after cancelling
Buttons: TAP_CANCELLATIONS

I can't cancel anything. With an account: open the order (**Orders**, then tap it) and tap **Request cancellation** at the bottom; it's there until the rider sets out for a pickup, or until you hand the parcel in at a counter. Our team decides, and the answer shows on the order and in the **Cancellations** tab of **Orders**. Booked as a guest: contact our team on WhatsApp or by phone. Refunds are arranged by our team, not in the app.

## Paying
Asked as: pay, payment, pay now, pay online, payment failed, pay later, cash on delivery, COD, pay at pickup, pay at counter, retry payment

You choose how to pay when you book: online, to the rider at pickup, at the counter when you drop off, or at delivery. If you chose online and it isn't paid yet, open the order and tap **Pay** under **Payment**. If a payment failed, try again from there; don't pay twice while one says it's being confirmed. The amount at booking is an estimate until the parcel is weighed.

## WhatsApp messages from Bombino
Asked as: WhatsApp, whatsapp messages, stop whatsapp, unsubscribe, too many messages, opt out, start messages

Your sign-in code and order updates come on WhatsApp. With an account, reply **STOP** to one of our WhatsApp messages to stop the updates, and **START** to turn them back on. Replies to those messages don't reach a person: to talk to our team, use **WhatsApp Support** in the menu (☰).

## Talking to our team
Asked as: contact, support, customer care, helpline, phone number, call, speak to someone, human, complaint, email support
Buttons: TAP_CONTACT_US

Open the menu (☰): **WhatsApp Support** opens a chat with our team, and **Call Support** calls +91 22 6640 0000. The same two buttons are under my answers when you need them. I can't pass anything to the team for you, so reach them directly.

## What BIA can and can't do
Asked as: BIA, assistant, chatbot, what can you do, help, can you book for me, can you cancel, can you change, new chat, clear chat, restart chat, rate the answer, thumbs

I'm a guide. I can tell you where your order is and what happens next, explain any step, error or term in the app, check pickup at a pincode, find a counter, quote rates, track an AWB, and tell you exactly where to do something. I can't do anything for you: I don't book, cancel, pay, upload, or change your details or an order. For those I'll point you to the right screen. Open me with the sparkle button at the bottom right of any screen, or **Ask BIA** in the menu. **New chat** at the top starts over; the thumbs under an answer tell us whether it helped.

## Privacy and your data
Asked as: privacy, my data, delete my data, delete account, personal data, data protection, privacy policy

The **Privacy Policy** (linked from the sign-in and signup screens) explains what we collect, why, and who we share it with. To see, correct or delete your data, or withdraw consent, contact us on the details in the policy, or through **WhatsApp Support** or **Call Support** in the menu (☰). The app itself has no delete-account button.
