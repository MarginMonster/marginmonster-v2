# Multi-currency — what is on, and what Wix cannot do

## Done, live now

The Wix **Currency Converter** app was installed via the App Installation API
(instance `80a96412-f4a3-42e8-9624-8e7b344144e2`) and these display currencies
are enabled:

    USD  CAD  GBP  EUR  AUD  MXN  JPY

USD is first because it is the base. Changing the list is one API call —
`PUT /settings/v1/currencies/site` with the full replacement list.

Product prices were **not** touched. Wix converts them at its own live
exchange rates, which it manages and updates itself. From the Site Currency
API docs:

> The original prices in products, services, and other catalog items remain
> unchanged.

That is exactly the "prices and shipping costs can remain the same" ask.

## The one thing Wix will not do

Wix separates two settings, and only one of them is per-currency:

| | setting | scope |
| --- | --- | --- |
| What the buyer **sees** | Site Currency API | many currencies |
| What the buyer is **charged in** | `paymentCurrency` site property | **one value, site-wide** |

`paymentCurrency` is `USD` and there is no per-region version of it. A buyer in
Canada browses in CAD, sees CAD, and the charge settles in **USD** — their card
issuer does the conversion and may add its own FX fee.

So "advertised in CAD" is delivered. "Billed in CAD" is not available on Wix
without running a separate site per currency, which would mean duplicating the
whole catalogue. Not worth it.

In practice a Canadian wholesale buyer can already pay a USD invoice with a CAD
card, so the gap is the FX fee and the currency printed on their statement — not
their ability to buy.

## The margin hole this opened, and the fix

The shipping plugin originally echoed the buyer's viewing currency onto its
price:

```js
const currency = (options && options.currency) || 'USD';   // WRONG
cost: { price: air.toFixed(2), currency }
```

`RATE_PER_KG` is **9.09 US dollars**. Echoing `CAD` there would hand Wix a
USD-sized number labelled CAD and charge it at face value — at roughly
0.73 USD/CAD that is about **a quarter under cost**, on every air shipment to
Canada. Precisely the loss we said never happens.

It now pins to `RATE_CURRENCY = 'USD'` and lets Wix convert, the same way it
converts the goods. Shipping and product prices therefore move together instead
of drifting apart. Two tests hold the line: one asserts every returned rate
stays `USD` whatever the request currency is, and one asserts the figure itself
does not change with the viewing currency.

## Still to do in the Editor

Enabling the currencies does not place the picker. Someone has to drag a
**Currency Converter** element onto the site header in the Editor and publish,
or buyers never get to switch. Until then the list is enabled but unreachable.
