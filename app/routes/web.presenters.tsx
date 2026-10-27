import { json, type LoaderFunctionArgs, type MetaFunction } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import { Ico } from "../lib/icons";
import { useT } from "../lib/ui-lang";
import { requireWebIdentity } from "../lib/web-auth.server";
import { LIVE_AVATARS, avatarImg, DESIGNED_VOICES, privateCastFor } from "../lib/avatars";

export const meta: MetaFunction = () => [{ title: "Your presenters · EASYMODE" }];

// The dedicated Presenter Hub. A browsable gallery of the full pro cast (the
// "flex") with the custom-avatar forge hero up top. Cast data mirrors the Studio
// loader exactly so the same faces show in both places. Cards use the uniform
// head-and-shoulders STILLS (avatars/{id}_0.jpg via avatarImg) — NOT the
// voice-videos clips, which were the poorly-cropped framing the owner rejected.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { account, shop } = await requireWebIdentity(request);
  const { customCastFor } = await import("../lib/custom-avatars.server");
  const custom = await customCastFor(shop.id);
  const cast = [
    ...custom.filter((c) => c.status === "ready").map((c) => ({ id: c.id, name: c.name, img: c.img, custom: true })),
    ...[...privateCastFor(account.email, shop.id, shop.domain), ...LIVE_AVATARS].map((a) => ({ id: a.id, name: a.name, img: avatarImg(a.id, 0), custom: false })),
  ];
  const brandFaceId = shop.brandAvatarId && cast.some((c) => c.id === shop.brandAvatarId) ? shop.brandAvatarId : null;
  // Brand Face leads the grid (your face, front and center), then everyone else.
  const bf = cast.find((c) => c.id === brandFaceId);
  const ordered = bf ? [bf, ...cast.filter((c) => c.id !== brandFaceId)] : cast;
  const forging = custom.filter((c) => c.status !== "ready").length;
  return json({ cast: ordered, brandFaceId, forging });
};

export default function PresenterHub() {
  const { cast, brandFaceId, forging } = useLoaderData<typeof loader>();
  const t = useT();
  return (
    <div className="ph-wrap">
      <style>{PH_STYLE}</style>
      <div className="ph-head">
        <b>{t("Your presenters")}</b>
        <span>{t("A full cast of pro presenters, ready to film your product — or upload a photo and become the face of your brand.")}</span>
      </div>

      {/* Forge hero — the differentiator, made prominent. */}
      <Link to="/web/studio?do=video&forge=1" className="ph-forge">
        <span className="ph-forge-l">
          <span className="ph-forge-ico" aria-hidden="true"><Ico n="wand" size={22} /></span>
          <span className="ph-forge-txt">
            <b>{t("Create your own presenter")}</b>
            <span>{t("Be the face of your brand — you, a model, or your mascot. Four outfits, yours alone.")}</span>
          </span>
        </span>
        <span className="ph-forge-go"><Ico n="camera" size={14} /> {t("Upload a photo")}</span>
      </Link>
      {forging > 0 && (
        <p className="ph-forging"><Ico n="bolt" size={13} /> {t("{n} presenter(s) still forging — they'll appear below when ready.", { n: forging })}</p>
      )}

      <div className="ph-castlbl">
        {t("The cast")}
        <span>{t("tap one to star in your video")}{brandFaceId ? <> · <Ico n="star" size={11} /> {t("is your Brand Face")}</> : null}</span>
      </div>
      <div className="ph-grid">
        {cast.map((c) => {
          const isBf = c.id === brandFaceId;
          return (
            <Link key={c.id} to={`/web/studio?do=video&avatar=${c.id}`} className={`ph-face${isBf ? " bf" : ""}`}>
              {isBf && <span className="ph-bfbadge"><Ico n="star" size={10} /> {t("Brand Face")}</span>}
              {c.custom && !isBf && <span className="ph-yoursbadge">{t("Yours")}</span>}
              <span className="ph-face-img" style={{ backgroundImage: `url(${c.img})` }} role="img" aria-label={c.name} />
              <span className="ph-face-nm">{c.name}</span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

const PH_STYLE = `
.ph-wrap{max-width:780px;margin:0 auto;}
.ph-head b{font-family:Poppins,sans-serif;font-weight:800;font-size:22px;color:var(--ink,#14201A);display:block;}
.ph-head>span{display:block;font-size:13px;color:var(--ink2,#4A554E);margin-top:4px;max-width:500px;line-height:1.45;}
.ph-forge{display:flex;align-items:center;justify-content:space-between;gap:14px;margin:16px 0 8px;padding:18px 20px;border-radius:16px;background:linear-gradient(135deg,#0C7A46,#0A5F38);color:#FBF6E6;box-shadow:0 8px 22px rgba(10,95,56,.28);text-decoration:none;transition:transform .12s,box-shadow .12s;}
.ph-forge:hover{transform:translateY(-2px);box-shadow:0 12px 28px rgba(10,95,56,.34);}
.ph-forge-l{display:flex;align-items:center;gap:14px;min-width:0;}
.ph-forge-ico{flex:0 0 auto;width:44px;height:44px;border-radius:12px;background:rgba(255,255,255,.16);display:grid;place-items:center;color:#FBF6E6;}
.ph-forge-txt{min-width:0;}
.ph-forge-txt b{font-family:Poppins,sans-serif;font-weight:800;font-size:16px;display:block;}
.ph-forge-txt span{font-size:12.5px;opacity:.9;display:block;margin-top:2px;line-height:1.35;}
.ph-forge-go{flex:0 0 auto;display:inline-flex;align-items:center;gap:5px;background:#FBF6E6;color:var(--green,#0C7A46);font-weight:800;font-size:13px;border-radius:999px;padding:10px 16px;white-space:nowrap;}
.ph-forging{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--ink2,#4A554E);margin:0 0 6px;}
.ph-castlbl{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;font-weight:800;font-size:14px;color:var(--ink,#14201A);margin:18px 0 12px;}
.ph-castlbl span{display:inline-flex;align-items:center;gap:4px;font-weight:600;font-size:12px;color:var(--ink2,#4A554E);}
.ph-grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px;}
.ph-face{position:relative;border-radius:14px;overflow:hidden;border:1.5px solid var(--line,#E4DFCF);background:#fff;cursor:pointer;text-decoration:none;display:block;transition:transform .12s,box-shadow .12s,border-color .12s;}
.ph-face:hover{transform:translateY(-2px);box-shadow:0 8px 18px rgba(20,32,26,.14);border-color:var(--green2,#1FA463);}
.ph-face-img{display:block;width:100%;aspect-ratio:3/4;background-size:cover;background-position:center 18%;background-color:#EAF6EF;}
.ph-face-nm{display:block;padding:7px 8px;font-size:12px;font-weight:700;color:var(--ink,#14201A);text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.ph-face.bf{border-color:var(--gold,#D3A63A);box-shadow:0 0 0 1.5px var(--gold,#D3A63A);}
.ph-bfbadge{position:absolute;top:7px;left:7px;z-index:2;display:inline-flex;align-items:center;gap:3px;background:var(--gold,#D3A63A);color:#3A2C06;font-size:10px;font-weight:800;border-radius:999px;padding:2px 8px;box-shadow:0 2px 5px rgba(0,0,0,.2);}
.ph-yoursbadge{position:absolute;top:7px;left:7px;z-index:2;background:var(--green,#0C7A46);color:#fff;font-size:10px;font-weight:800;border-radius:999px;padding:2px 8px;box-shadow:0 2px 5px rgba(0,0,0,.2);}
@media(max-width:640px){.ph-grid{grid-template-columns:repeat(3,minmax(0,1fr));}.ph-forge{flex-direction:column;align-items:flex-start;}.ph-forge-go{align-self:stretch;justify-content:center;}}
`;
