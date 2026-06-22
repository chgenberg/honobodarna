import { getSetting, setSetting } from "./db.js";

export type TemplateType = "sjobod" | "villa" | "bike" | "package";
export type Lang = "sv" | "en";

export interface Template {
  text: string; // används för både SMS och e-posttext
  subject: string; // e-postämne
}

// Variabler som ersätts: {namn} {fulltnamn} {stuga} {kod}
const DEFAULTS: Record<TemplateType, Record<Lang, Template>> = {
  sjobod: {
    sv: {
      subject: "Välkommen till Hönö Sjöbodar",
      text: `Hej {namn}!

Varmt välkomna till Hönö Sjöbodar idag. Vad härligt det ska bli att ha er på besök!

Adressen är Lökholmsvägen 10, där ligger sex röda sjöbodar mittemot bensinstationen.

Ni ska bo i {stuga}. Se nedan kod ni använder för att komma in:

{stuga}: {kod}, avsluta med "låsa-upp-knappen"

Wifi: {stuga}
Lösenord: Hono123!

Bara hör av er om ni har några frågor. Ni når mig snabbast på telefon eller sms till 0706 47 30 86.

Önskar er en fin vistelse!

Bästa hälsningar,
Anna`,
    },
    en: {
      subject: "Welcome to Hönö Sjöbodar",
      text: `Hello {namn},

Most welcome to Hönö Sjöbodar today, we are looking forward to be hosting you.

The address is Lökholmsvägen 10 at Hönö. There you have 6 cabins opposite to the petrol station. Your cabin is {stuga}, you will use a code to access the cabin. Your code is: {kod}, end with the "lock-up-button".

Wifi: {stuga}
password: Hono123!

We have arranged with bed linen and towels.

If you have any questions please feel free to contact me, you will reach me on text or phone to +46 706 47 30 86.

Wish you a wonderful stay!

All the best,
Anna`,
    },
  },
  villa: {
    sv: {
      subject: "Välkommen till Hönö Sjöbodar – Villan",
      text: `Hej {namn}!

Varmt välkomna till Hönö Sjöbodar idag. Vad härligt det ska bli att ha er på besök!

Ni ska bo i vår villa som ligger på Bustadvägen 63, där ligger ett vitt lågt hus längst ner på höger sida av vägen.

Se nedan kod ni använder för att komma in:

Villan: {kod}

Wifi villan: tp-link
Lösenord: 63803662

Bara hör av er om ni har några frågor. Ni når mig snabbast på telefon eller sms till 0706 47 30 86.

Önskar er en fin vistelse!

Varma hälsningar
Anna`,
    },
    en: {
      subject: "Welcome to Hönö – the Villa",
      text: `Hello {namn},

Most welcome to Hönö today! We are looking forward to host you. The villa you have booked is located on Bustadvägen 63, 47540 Hönö. There is a white house on the right hand side of the road.

When you arrive you check in with a code to open the door, {kod}.

Wi-Fi: tp-link
Password: 63803662

Just let us know if there is anything you need. You will reach me on text or phone to +46 706 47 30 86.

Most welcome and wish you a wonderful stay!

All the best,
Anna`,
    },
  },
  package: {
    sv: {
      subject: "Välkommen till Hönö Sjöbodar – sjöbod & middag",
      text: `Varmt välkomna till Hönö Sjöbodar idag. Vad härligt det ska bli att ha er på besök!

Adressen är Lökholmsvägen 10, där ligger sex röda sjöbodar mittemot bensinstationen.

Ni ska bo i {stuga}. Se nedan kod ni använder för att komma in:

{stuga}: {kod}, avsluta med "låsa-upp-knappen"

Wifi: {stuga}
Lösenord: Hono123!

Ni har middag bokat på Tullhuset ikväll kl 19.00.

Bara hör av er om ni har några frågor. Ni når mig snabbast på telefon eller sms till 0706 47 30 86.

Önskar er en fin vistelse!

Bästa hälsningar,
Anna Joelsson`,
    },
    en: {
      subject: "Welcome to Hönö Sjöbodar – cabin & dinner",
      text: `Hello {namn},

Most welcome to Hönö Sjöbodar today, we are looking forward to be hosting you.

The address is Lökholmsvägen 10 at Hönö. There you have 6 cabins opposite to the petrol station. Your cabin is {stuga}, you will use a code to access the cabin. Your code is: {kod}, end with the "lock-up-button".

Wifi: {stuga}
password: Hono123!

We have arranged with bed linen and towels.

Your dinner is reserved at Tullhuset tonight, at 7 pm.

If you have any questions please feel free to contact me, you will reach me on text or phone to +46 706 47 30 86.

Wish you a wonderful stay!

All the best,
Anna`,
    },
  },
  bike: {
    sv: {
      subject: "Din cykelbokning – Hönö Sjöbodar",
      text: `Hej {namn}!

Tack för att ni hyrt cyklar av oss!

Cyklarna finns på området utanför Hönö Sjöbodar, på Lökholmsvägen 10.

Runt cyklarna sitter en kedja med ett kodlås. Koden för att öppna låset är: {kod}. Avsluta med låsknappen.

Ta de cyklar ni vill använda och lås sedan de kvarvarande cyklarna igen. Använd samma kod när ni lämnar tillbaka cyklarna.

Om däcken behöver pumpas kan det göras på bensinstationen mitt emot sjöbodarna.

Trevlig cykeltur!

Med vänliga hälsningar,
Anna`,
    },
    en: {
      subject: "Your bike rental – Hönö Sjöbodar",
      text: `Hello {namn},

Thanks for renting bikes with us today.

Your bikes are located by Hönö Sjöbodar at Lökholmsvägen 10 (the red sea lodges opposite to the petroleum station).

Around the bikes is a chain with a code lock, your code to open: {kod}, end with the lock-up-button.

Grab your bikes and lock the remaining once. Please use the same code when you leave the bikes again.

If the tires need inflating, that can be fixed at the gas station opposite the boathouses.

Enjoy the ride!

All the best,
Anna`,
    },
  },
};

export function getTemplate(type: TemplateType, lang: Lang): Template {
  return {
    text: getSetting(`tmpl_${type}_${lang}_text`) ?? DEFAULTS[type][lang].text,
    subject: getSetting(`tmpl_${type}_${lang}_subject`) ?? DEFAULTS[type][lang].subject,
  };
}

export function setTemplate(type: TemplateType, lang: Lang, text: string, subject: string): void {
  setSetting(`tmpl_${type}_${lang}_text`, text);
  setSetting(`tmpl_${type}_${lang}_subject`, subject);
}

// Engelska om numret finns och INTE börjar på +46. Saknas nummer → svenska.
export function langForPhone(phone?: string | null): Lang {
  if (!phone) return "sv";
  return phone.startsWith("+46") ? "sv" : "en";
}

export function render(tmpl: string, vars: Record<string, string>): string {
  return tmpl.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? "");
}

export const TEMPLATE_LABELS: Record<TemplateType, string> = {
  sjobod: "Sjöbodar",
  villa: "Villan",
  package: "Paket (sjöbod + middag)",
  bike: "Cyklar",
};

export function getAllTemplates(): Record<TemplateType, Record<Lang, Template>> {
  return {
    sjobod: { sv: getTemplate("sjobod", "sv"), en: getTemplate("sjobod", "en") },
    villa: { sv: getTemplate("villa", "sv"), en: getTemplate("villa", "en") },
    package: { sv: getTemplate("package", "sv"), en: getTemplate("package", "en") },
    bike: { sv: getTemplate("bike", "sv"), en: getTemplate("bike", "en") },
  };
}
