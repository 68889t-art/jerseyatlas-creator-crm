import { createClient } from "npm:@supabase/supabase-js@2";

const APP_ORIGIN = "https://68889t-art.github.io";
const ALLOWED_ORIGINS = new Set([APP_ORIGIN, "http://localhost:5500", "http://127.0.0.1:5500"]);
const ALLOWED_TIKTOK_HOSTS = new Set([
  "tiktok.com", "www.tiktok.com", "m.tiktok.com", "vm.tiktok.com", "vt.tiktok.com",
]);
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

function headers(origin: string) {
  const allowed = origin && ALLOWED_ORIGINS.has(origin) ? origin : APP_ORIGIN;
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  };
}

function reply(body: unknown, status: number, origin: string) {
  return new Response(JSON.stringify(body), { status, headers: headers(origin) });
}

function normalizeTikTokUrl(input: string, kind: "profile" | "video") {
  let url: URL;
  try { url = new URL(input.trim()); } catch { throw new Error("请粘贴有效的 TikTok 公开链接。"); }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("只支持 TikTok 的 HTTP/HTTPS 公开链接。");
  if (!ALLOWED_TIKTOK_HOSTS.has(url.hostname.toLowerCase())) throw new Error("目前只支持 TikTok 链接，不接受其他网站地址。");
  if (kind === "profile" && !/^\/@[A-Za-z0-9._]+\/?$/.test(url.pathname)) {
    if (!["vm.tiktok.com", "vt.tiktok.com"].includes(url.hostname.toLowerCase())) {
      throw new Error("主页链接格式应为 https://www.tiktok.com/@用户名");
    }
  }
  if (kind === "video" && !/\/(video|photo)\/\d+/.test(url.pathname) &&
      !["vm.tiktok.com", "vt.tiktok.com"].includes(url.hostname.toLowerCase())) {
    throw new Error("作品链接应包含 /video/视频ID，或使用 TikTok 分享短链接。");
  }
  return url;
}

async function fetchTikTokPage(input: string, kind: "profile" | "video") {
  const initial = normalizeTikTokUrl(input, kind);
  const response = await fetch(initial.toString(), {
    method: "GET",
    redirect: "follow",
    headers: {
      "User-Agent": UA,
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "Referer": "https://www.tiktok.com/",
      "Cache-Control": "no-cache",
    },
    signal: AbortSignal.timeout(15000),
  });
  const finalUrl = new URL(response.url || initial.toString());
  if (!ALLOWED_TIKTOK_HOSTS.has(finalUrl.hostname.toLowerCase())) {
    throw new Error("TikTok 分享链接跳转到了非 TikTok 域名，已出于安全原因停止请求。");
  }
  if (response.status === 403 || response.status === 429) {
    throw new Error("TikTok 暂时限制了云端访问（HTTP " + response.status + "）。请稍后重试；本次没有修改或保存达人资料。");
  }
  if (!response.ok) throw new Error("TikTok 页面暂时无法读取（HTTP " + response.status + "）。");
  const html = await response.text();
  if (html.length > 12_000_000) throw new Error("TikTok 返回页面过大，已停止解析。");
  if (/captcha|verify to continue|access denied|机器人验证/i.test(html.slice(0, 500000))) {
    throw new Error("TikTok 要求额外验证，免费云端采集暂时无法读取此页面。可稍后重试或人工填写。");
  }
  return { html, finalUrl: finalUrl.toString() };
}

function embeddedState(html: string) {
  const patterns = [
    /<script[^>]*id=["']__UNIVERSAL_DATA_FOR_REHYDRATION__["'][^>]*>([\s\S]*?)<\/script>/i,
    /<script[^>]*id=["']SIGI_STATE["'][^>]*>([\s\S]*?)<\/script>/i,
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (!match?.[1]) continue;
    try { return JSON.parse(match[1]); } catch { /* try the next public page state */ }
  }
  return null;
}

function scopeOf(state: any) {
  return state?.__DEFAULT_SCOPE__ || state;
}
function asCount(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
}
function isoDate(seconds: unknown): string | null {
  const n = Number(seconds);
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Date(n * 1000).toISOString().slice(0, 10);
}
function regionLabel(value: unknown): string | null {
  const code = String(value || "").trim().toUpperCase();
  const map: Record<string, string> = {
    GB: "英国", UK: "英国", FR: "法国", DE: "德国", US: "美国", BR: "巴西",
    UNITED_KINGDOM: "英国", FRANCE: "法国", GERMANY: "德国", UNITED_STATES: "美国", BRAZIL: "巴西",
  };
  return map[code] || null;
}

function parseProfile(state: any) {
  const scope = scopeOf(state);
  const detail = scope?.["webapp.user-detail"];
  const info = detail?.userInfo || detail;
  let user = info?.user || null;
  let stats = info?.statsV2 || info?.stats || user?.statsV2 || user?.stats || null;

  if (!user && state?.UserModule?.users) {
    const users = Object.values(state.UserModule.users) as any[];
    user = users[0] || null;
    const uid = user?.id || user?.uid;
    stats = state.UserModule.stats?.[uid] || null;
  }
  if (!user) return null;

  const username = String(user.uniqueId || user.unique_id || user.username || "").replace(/^@/, "");
  if (!username) return null;
  const region = user.region || info?.region || null;
  return {
    username,
    nickname: user.nickname || user.nickName || user.displayName || username,
    followers: asCount(stats?.followerCount ?? stats?.follower_count ?? user.followerCount),
    region: region ? String(region) : null,
    regionLabel: regionLabel(region),
    profileUrl: "https://www.tiktok.com/@" + encodeURIComponent(username),
    verified: Boolean(user.verified),
  };
}

function parseVideo(state: any) {
  const scope = scopeOf(state);
  const detail = scope?.["webapp.video-detail"];
  let item = detail?.itemInfo?.itemStruct || detail?.itemInfo?.item || null;
  if (!item && state?.ItemModule) {
    const values = Object.values(state.ItemModule) as any[];
    item = values[0] || null;
  }
  if (!item) return null;
  const author = item.author || {};
  const stats = item.statsV2 || item.stats || {};
  const username = String(author.uniqueId || author.unique_id || author.username || "").replace(/^@/, "");
  return {
    username: username || null,
    nickname: author.nickname || author.nickName || null,
    profileUrl: username ? "https://www.tiktok.com/@" + encodeURIComponent(username) : null,
    playCount: asCount(stats.playCount ?? stats.play_count),
    likeCount: asCount(stats.diggCount ?? stats.likeCount ?? stats.digg_count),
    commentCount: asCount(stats.commentCount ?? stats.comment_count),
    shareCount: asCount(stats.shareCount ?? stats.share_count),
    collectCount: asCount(stats.collectCount ?? stats.collect_count),
    postedAt: isoDate(item.createTime ?? item.create_time),
    caption: String(item.desc || "").slice(0, 500),
    videoId: String(item.id || ""),
  };
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("Origin") || "";
  if (req.method === "OPTIONS") return new Response("ok", { headers: headers(origin) });
  if (req.method !== "POST") return reply({ ok: false, error: "只接受 POST 请求。" }, 405, origin);
  if (origin && !ALLOWED_ORIGINS.has(origin)) return reply({ ok: false, error: "来源网站未获授权。" }, 403, origin);

  try {
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) return reply({ ok: false, error: "请先登录 CRM。" }, 401, origin);
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
    if (!supabaseUrl || !supabaseKey) throw new Error("Supabase Edge Function 环境配置不完整。");

    const supabase = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const token = authHeader.slice("Bearer ".length);
    const { data: userData, error: authError } = await supabase.auth.getUser(token);
    if (authError || !userData?.user) return reply({ ok: false, error: "登录会话无效，请重新登录 CRM。" }, 401, origin);
    const { data: profile, error: profileError } = await supabase
      .from("profiles").select("id,role,is_active,team_id").eq("id", userData.user.id).maybeSingle();
    if (profileError || !profile || !profile.is_active || profile.role !== "admin" || !profile.team_id) {
      return reply({ ok: false, error: "仅已激活的 CRM 管理员可以使用 TikTok 自动识别。" }, 403, origin);
    }

    const body = await req.json().catch(() => ({}));
    const kind = body?.kind === "profile" ? "profile" : body?.kind === "video" ? "video" : null;
    const inputUrl = typeof body?.url === "string" ? body.url.trim() : "";
    if (!kind || !inputUrl || inputUrl.length > 2048) {
      return reply({ ok: false, error: "请求参数不正确，请检查 TikTok 链接。" }, 400, origin);
    }

    const { html, finalUrl } = await fetchTikTokPage(inputUrl, kind);
    const state = embeddedState(html);
    if (!state) {
      return reply({ ok: false, error: "页面已打开，但 TikTok 没有提供可读取的公开资料。可能是地区限制、登录墙或页面结构变化；未保存任何数据。" }, 422, origin);
    }
    const data = kind === "profile" ? parseProfile(state) : parseVideo(state);
    if (!data) {
      return reply({ ok: false, error: "没有在 TikTok 页面中找到所需的公开资料。请确认账号/作品公开且链接正确；未保存任何数据。" }, 422, origin);
    }
    if (kind === "profile" && !data.username) {
      return reply({ ok: false, error: "TikTok 页面没有返回用户名，无法安全匹配达人。" }, 422, origin);
    }
    if (kind === "video" && data.playCount === null) {
      return reply({ ok: false, error: "读取到了作品页面，但没有取得播放量。请稍后重试或手动填写。" }, 422, origin);
    }
    return reply({ ok: true, kind, data, resolvedUrl: finalUrl, fetchedAt: new Date().toISOString(), source: "TikTok 公开页面" }, 200, origin);
  } catch (error) {
    const message = error instanceof Error ? error.message : "自动识别失败。";
    return reply({ ok: false, error: message.slice(0, 300) }, 502, origin);
  }
});
