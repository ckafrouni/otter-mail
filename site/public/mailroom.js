// The landing page's hero: Otter Mail as a mail room, in glass. Mail drops in from
// Gmail and IMAP, rides a belt through the search index, and arms sort it into
// labels while junk is pushed aside. The rest lands in the inbox, which every device
// shows the same; an arm files it in the archive (E) or hands it to the agent, whose
// reply rides back out to Gmail (R). A plain canvas and an orthographic camera.

(() => {
  const root = document.querySelector(".mailroom");
  const canvas = root?.querySelector("canvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const toggle = root.querySelector("button");

  // ── The look ────────────────────────────────────────────────────────────────

  const INK = "34, 56, 90";
  const GLASS = "116, 152, 204";
  const BLUE = "47, 124, 246";
  const LABELS = { northwind: "142, 99, 206", hiring: "222, 132, 28", finance: "28, 150, 108" };
  const AVATARS = ["142, 99, 206", "47, 124, 246", "222, 132, 28", "28, 150, 108", "214, 80, 92"];
  const SANS = '-apple-system, BlinkMacSystemFont, "Inter Variable", Inter, system-ui, sans-serif';
  const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';

  const look = (tint, top, front, side, edge, back = 0) => ({ tint, top, front, side, edge, back });
  const GLASS_S = look(GLASS, 0.07, 0.11, 0.17, 0.42, 0.1);
  const PANE_S = look(GLASS, 0.05, 0.07, 0.1, 0.38, 0.08);
  const FLOOR_S = look(GLASS, 0.06, 0.12, 0.16, 0.32);
  const WHITE_S = look("255, 255, 255", 0.97, 0.92, 0.85, 0.5);
  const JOINT_S = look(GLASS, 0.45, 0.4, 0.5, 0.5);
  const KEY_S = look(BLUE, 0.35, 0.3, 0.4, 0.6);
  const JUNK_S = look("232, 234, 238", 0.95, 0.9, 0.85, 0.42);
  const tinted = (s, rgb) => ({ ...s, ink: rgb, edge: 0.7 });

  const rgba = (rgb, a) => `rgba(${rgb}, ${Math.max(0, Math.min(1, a)).toFixed(3)})`;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
  const add = (p, q) => [p[0] + q[0], p[1] + q[1], p[2] + q[2]];
  const mul = (p, k) => [p[0] * k, p[1] * k, p[2] * k];
  const mix = (p, q, t) => [lerp(p[0], q[0], t), lerp(p[1], q[1], t), lerp(p[2], q[2], t)];

  // Always the same mail room: a small seeded random.
  let seed = 11;
  const random = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  // ── The camera: orthographic, down the length of the floor ──────────────────

  const YAW = 0.2;
  const PITCH = 0.62;
  const CY = Math.cos(YAW);
  const SY = Math.sin(YAW);
  const SP = Math.sin(PITCH);
  const CP = Math.cos(PITCH);
  const TOWARD = [SY * CP, CY * CP, SP];
  let u = 20; // device pixels per world unit
  let ox = 0;
  let oy = 0;
  let px = 1; // device pixels per CSS pixel

  const project = ([x, y, z]) => {
    const xr = x * CY - y * SY;
    const yr = x * SY + y * CY;
    return [ox + xr * u, oy + (yr * SP - z * CP) * u, yr * CP + z * SP];
  };
  const vector = ([x, y, z]) => [(x * CY - y * SY) * u, ((x * SY + y * CY) * SP - z * CP) * u];
  // The back of the room fades away.
  const fog = (depth) => clamp(0.3 + ((depth + 9) / 18) * 0.7, 0.3, 1);

  // ── Drawing: everything is queued with its depth, then painted back to front ─

  let queue = [];
  const later = (depth, draw) => queue.push({ depth, draw });
  const FLOOR = -1e6;

  function path(points) {
    ctx.beginPath();
    ctx.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i][0], points[i][1]);
    ctx.closePath();
  }

  const FACES = [
    [0, 1, 2, 3],
    [4, 5, 6, 7],
    [0, 1, 5, 4],
    [3, 2, 6, 7],
    [0, 3, 7, 4],
    [1, 2, 6, 5],
  ];
  const EDGES = [
    [0, 1, 0, 2],
    [1, 2, 0, 5],
    [2, 3, 0, 3],
    [3, 0, 0, 4],
    [4, 5, 1, 2],
    [5, 6, 1, 5],
    [6, 7, 1, 3],
    [7, 4, 1, 4],
    [0, 4, 2, 4],
    [1, 5, 2, 5],
    [2, 6, 3, 5],
    [3, 7, 3, 4],
  ];

  /** A box from a corner and its three edges, in any orientation. */
  function block(o, a, b, c, s, { alpha = 1, depth } = {}) {
    const base = [o, add(o, a), add(add(o, a), b), add(o, b)];
    const pts = [...base, ...base.map((p) => add(p, c))].map(project);
    const normals = [mul(c, -1), c, mul(b, -1), b, mul(a, -1), a];
    const shown = normals.map((n) => n[0] * TOWARD[0] + n[1] * TOWARD[1] + n[2] * TOWARD[2] > 1e-9);
    const middle = pts.reduce((sum, p) => sum + p[2], 0) / 8;
    later(depth ?? middle, () => {
      const f = fog(middle) * alpha;
      if (s.back) {
        ctx.strokeStyle = rgba(INK, s.back * f);
        ctx.beginPath();
        for (const [i, j, fa, fb] of EDGES) {
          if (shown[fa] || shown[fb]) continue;
          ctx.moveTo(pts[i][0], pts[i][1]);
          ctx.lineTo(pts[j][0], pts[j][1]);
        }
        ctx.stroke();
      }
      FACES.forEach((face, k) => {
        if (!shown[k]) return;
        const [nx, ny, nz] = normals[k];
        const up = nz / Math.hypot(nx, ny, nz);
        const tone = up > 0.5 ? s.top : Math.abs(nx) > Math.abs(ny) ? s.side : s.front;
        ctx.fillStyle = rgba(s.tint, tone * f);
        path(face.map((i) => pts[i]));
        ctx.fill();
      });
      ctx.strokeStyle = rgba(s.ink ?? INK, s.edge * f);
      ctx.beginPath();
      for (const [i, j, fa, fb] of EDGES) {
        if (!shown[fa] && !shown[fb]) continue;
        ctx.moveTo(pts[i][0], pts[i][1]);
        ctx.lineTo(pts[j][0], pts[j][1]);
      }
      ctx.stroke();
    });
  }
  const box = (x, y, z, w, d, h, s, opts) =>
    block([x, y, z], [w, 0, 0], [0, d, 0], [0, 0, h], s, opts);
  /** A platform: drawn before anything standing on it. */
  const slab = (x, y, z, w, d, h, s) =>
    box(x, y, z, w, d, h, s, { depth: project([x + w / 2, y, z + h])[2] - 0.3 });

  function hull(points) {
    const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lower = [];
    const upper = [];
    for (const q of p) {
      while (lower.length > 1 && cross(lower.at(-2), lower.at(-1), q) <= 0) lower.pop();
      lower.push(q);
    }
    for (let i = p.length - 1; i >= 0; i--) {
      while (upper.length > 1 && cross(upper.at(-2), upper.at(-1), p[i]) <= 0) upper.pop();
      upper.push(p[i]);
    }
    return [...lower.slice(0, -1), ...upper.slice(0, -1)];
  }

  function cylinder(x, y, z, r, h, s) {
    const ring = (zz) =>
      Array.from({ length: 18 }, (_, i) =>
        project([
          x + r * Math.cos((i / 18) * Math.PI * 2),
          y + r * Math.sin((i / 18) * Math.PI * 2),
          zz,
        ]),
      );
    const bottom = ring(z);
    const top = ring(z + h);
    const depth = project([x, y, z + h / 2])[2];
    later(depth, () => {
      const f = fog(depth);
      const outline = hull([...bottom, ...top]);
      ctx.fillStyle = rgba(s.tint, s.side * f);
      path(outline);
      ctx.fill();
      ctx.fillStyle = rgba(s.tint, s.top * f);
      path(top);
      ctx.fill();
      ctx.strokeStyle = rgba(s.ink ?? INK, s.edge * f);
      path(outline);
      ctx.stroke();
      path(top);
      ctx.stroke();
    });
  }

  /**
   * Draws in a plane in the room: local x runs along `right`, local y along `down`
   * (world vectors per local unit), from `o`; `size` (local units) places its depth.
   */
  function plane(o, right, down, size, draw, depth) {
    const middle = project(add(add(o, mul(right, size[0] / 2)), mul(down, size[1] / 2)))[2];
    const [x, y] = project(o);
    const r = vector(right);
    const dn = vector(down);
    later(depth ?? middle, () => {
      ctx.save();
      ctx.setTransform(r[0], r[1], dn[0], dn[1], x, y);
      draw(fog(middle));
      ctx.restore();
    });
  }

  /** Lettering, painted on the floor or, given its axes, on a face. */
  function letters(
    o,
    text,
    size,
    rgb,
    alpha,
    { right = [1, 0, 0], down = [0, 1, 0], depth = FLOOR + 2 } = {},
  ) {
    const k = size / 10;
    plane(
      o,
      mul(right, k),
      mul(down, k),
      [text.length * 7, 10],
      (f) => {
        ctx.font = `600 10px ${MONO}`;
        ctx.textBaseline = "top";
        if ("letterSpacing" in ctx) ctx.letterSpacing = "1.5px";
        ctx.fillStyle = rgba(rgb, alpha * f);
        ctx.fillText(text, 0, 0);
      },
      depth,
    );
  }

  /** A glass tube through `points`, drawn over what's beneath it. */
  function tube(points, r) {
    const pts = points.map(project);
    later(points.depth, () => {
      const f = fog(points.depth - 3);
      ctx.beginPath();
      pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.lineCap = "round";
      ctx.lineWidth = 2 * r * u;
      ctx.strokeStyle = rgba(INK, 0.3 * f);
      ctx.stroke();
      ctx.lineWidth = 2 * r * u - 1.8 * px;
      ctx.strokeStyle = rgba("250, 251, 254", 0.86 * f);
      ctx.stroke();
      ctx.lineWidth = 0.35 * r * u;
      ctx.strokeStyle = rgba(GLASS, 0.18 * f);
      ctx.stroke();
      ctx.lineWidth = px;
      ctx.lineCap = "butt";
    });
  }

  /** Points along a smooth curve through `points` (Catmull-Rom), evenly spaced. */
  function curve(points, step = 0.3) {
    const raw = [];
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[Math.max(0, i - 1)];
      const p1 = points[i];
      const p2 = points[i + 1];
      const p3 = points[Math.min(points.length - 1, i + 2)];
      for (let t = 0; t < 1; t += 0.05) {
        const t2 = t * t;
        const t3 = t2 * t;
        raw.push(
          [0, 1, 2].map(
            (k) =>
              0.5 *
              (2 * p1[k] +
                (-p0[k] + p2[k]) * t +
                (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 +
                (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3),
          ),
        );
      }
    }
    raw.push(points.at(-1));
    const out = [raw[0]];
    let carried = 0;
    for (let i = 1; i < raw.length; i++) {
      carried += Math.hypot(
        raw[i][0] - raw[i - 1][0],
        raw[i][1] - raw[i - 1][1],
        raw[i][2] - raw[i - 1][2],
      );
      if (carried >= step || i === raw.length - 1) {
        out.push(raw[i]);
        carried = 0;
      }
    }
    // Drawn after everything it passes over (depth doesn't depend on the zoom).
    out.depth = Math.max(...out.map((p) => project(p)[2])) + 0.05;
    return out;
  }
  const along = (points, t) => {
    const i = clamp(t, 0, 1) * (points.length - 1);
    const k = Math.min(Math.floor(i), points.length - 2);
    return mix(points[k], points[k + 1], i - k);
  };

  // ── The floor plan (x along the room, y toward you, z up) ────────────────────

  const SPEED = 2;
  const BELT_Y = -1.6;
  const BELT_Z = 1.2;
  const BELT_START = -15.8;
  const BELT_END = 11.6;
  const OUT_Y = 5.3;
  const OUT_Z = 0.78;
  const OUT_START = 19.6;
  const OUT_END = -17.6;
  const GMAIL = [-20, -5.8, 7.4];
  const IMAP = [-16.4, -5.8, 6.2];
  const ANTENNA = [-12.6, -8.6];
  const SCANNER_X = -11.4;
  const PUSHER_X = -7.6;
  const SORTERS = [
    ["northwind", -3.6],
    ["hiring", 0.9],
    ["finance", 5.4],
  ];
  const TRAY_Y = 2.5;
  const INBOX = [14, -1.6];
  const DRAWER_X = 20.8;
  const DESK = [18.2, 2.9];
  const FRONT = 9;
  const CACHE = [-9, -8.4];

  const TUBES = {
    gmail: curve([
      GMAIL,
      [GMAIL[0] + 0.2, GMAIL[1] + 0.6, 8.8],
      [-17, -2.8, 6.8],
      [BELT_START + 0.3, BELT_Y, 3],
      [BELT_START + 0.6, BELT_Y, BELT_Z + 0.1],
    ]),
    imap: curve([
      IMAP,
      [IMAP[0] + 0.1, IMAP[1] + 0.6, 7.2],
      [-15.6, -3.2, 5],
      [BELT_START + 0.4, BELT_Y, 2.8],
      [BELT_START + 0.6, BELT_Y, BELT_Z + 0.1],
    ]),
    send: curve([
      [OUT_END - 0.4, OUT_Y, OUT_Z + 0.1],
      [OUT_END - 0.9, OUT_Y, 4],
      [-19, 0.6, 9],
      [GMAIL[0] + 0.8, GMAIL[1] + 1.2, 9.4],
      [GMAIL[0] + 0.9, GMAIL[1] + 0.2, GMAIL[2]],
    ]),
  };

  function room(t) {
    // The floor, its grid, and what's painted on it.
    const [fx, fy, fw, fd] = [-27, -9, 53, 20.5];
    box(fx, fy, -0.5, fw, fd, 0.5, FLOOR_S, { depth: FLOOR });
    plane(
      [fx, fy, 0],
      [1, 0, 0],
      [0, 1, 0],
      [fw, fd],
      (f) => {
        ctx.lineWidth = 0.025;
        ctx.strokeStyle = rgba(INK, 0.07 * f);
        ctx.beginPath();
        for (let x = 1; x < fw; x += 2) {
          ctx.moveTo(x, 0);
          ctx.lineTo(x, fd);
        }
        for (let y = 1; y < fd; y += 2) {
          ctx.moveTo(0, y);
          ctx.lineTo(fw, y);
        }
        ctx.stroke();
        // Lanes along the belts.
        ctx.setLineDash([0.6, 0.4]);
        ctx.lineWidth = 0.05;
        ctx.strokeStyle = rgba(INK, 0.2 * f);
        ctx.beginPath();
        for (const [y, from, to] of [
          [BELT_Y - 1.3, BELT_START, BELT_END],
          [BELT_Y + 1.3, BELT_START, BELT_END],
          [OUT_Y + 1.2, OUT_END, OUT_START],
        ]) {
          ctx.moveTo(from - fx - 1, y - fy);
          ctx.lineTo(to - fx + 1, y - fy);
        }
        ctx.stroke();
        ctx.setLineDash([]);
      },
      FLOOR + 1,
    );

    const sign = (x, y, text, rgb = INK, alpha = 0.55) =>
      letters([x, y, 0], text, 0.55, rgb, alpha);
    sign(GMAIL[0] - 1.2, GMAIL[1] + 1.6, "GMAIL");
    sign(IMAP[0] - 0.9, IMAP[1] + 1.6, "IMAP");
    sign(CACHE[0] + 4.9, CACHE[1] + 1.95, "THE CACHE, ON YOUR DEVICE");
    sign(SCANNER_X - 1.6, BELT_Y + 1.6, "SEARCH");
    sign(INBOX[0] - 1.3, BELT_Y + 1.6, "INBOX", BLUE, 0.8);
    sign(14.4, OUT_Y + 1.3, "← REPLIES");

    // Gmail and IMAP: racks of servers, with tubes from their tops.
    for (const [x, y, h] of [GMAIL, IMAP]) {
      box(x - 1.5, y - 1.1, 0, 3, 2.2, h, GLASS_S);
      plane([x - 1.5, y + 1.1, h], [1, 0, 0], [0, 0, -1], [3, h], (f) => {
        ctx.lineWidth = 0.025;
        for (let k = 0; k * 0.5 + 0.6 < h; k++) {
          const top = 0.35 + k * 0.5;
          ctx.strokeStyle = rgba(INK, 0.22 * f);
          ctx.strokeRect(0.2, top, 2.6, 0.38);
          const on = Math.sin(t * (1.3 + (k % 3)) + k * 1.7 + x) > 0.2;
          ctx.fillStyle = rgba(on ? BLUE : INK, (on ? 0.7 : 0.2) * f);
          ctx.fillRect(2.35, top + 0.13, 0.12, 0.12);
          ctx.fillStyle = rgba(INK, 0.12 * f);
          ctx.fillRect(0.35, top + 0.15, 1.2, 0.08);
        }
      });
    }
    tube(TUBES.gmail, 0.3);
    tube(TUBES.imap, 0.3);
    tube(TUBES.send, 0.3);

    // The relay's antenna: it wakes every device when mail arrives.
    box(ANTENNA[0] - 0.9, ANTENNA[1] - 0.7, 0, 1.8, 1.4, 0.5, GLASS_S);
    letters([ANTENNA[0] - 0.62, ANTENNA[1] + 0.71, 0.4], "RELAY", 0.26, INK, 0.6, {
      down: [0, 0, -1],
      depth: project([ANTENNA[0], ANTENNA[1] + 0.7, 0.25])[2] + 0.05,
    });
    cylinder(ANTENNA[0], ANTENNA[1], 0.5, 0.36, 0.2, WHITE_S);
    box(ANTENNA[0] - 0.06, ANTENNA[1] - 0.06, 0.7, 0.12, 0.12, 5, WHITE_S);
    cylinder(ANTENNA[0], ANTENNA[1], 5.7, 0.28, 0.28, JOINT_S);
    for (const ping of pings) {
      const age = t - ping;
      if (age < 0 || age > 1.4) continue;
      plane([ANTENNA[0], ANTENNA[1], 5.85], [1, 0, 0], [0, 1, 0], [0, 0], (f) => {
        ctx.lineWidth = 0.05;
        ctx.strokeStyle = rgba(BLUE, (1 - age / 1.4) * 0.6 * f);
        ctx.beginPath();
        ctx.arc(0, 0, 0.4 + age * 1.3, 0, Math.PI * 2);
        ctx.stroke();
      });
    }

    belt(BELT_START, BELT_END, BELT_Y, BELT_Z, t, 1);
    belt(OUT_END, OUT_START, OUT_Y, OUT_Z, t, -1);

    // The search index: an arch the belt runs through, lit while it reads.
    for (const y of [BELT_Y - 1.25, BELT_Y + 1.05])
      box(SCANNER_X - 0.25, y, 0, 0.5, 0.2, 2.9, WHITE_S);
    box(SCANNER_X - 0.35, BELT_Y - 1.35, 2.9, 0.7, 2.7, 0.35, WHITE_S);
    plane([SCANNER_X, BELT_Y - 1.05, 2.85], [0, 1, 0], [0, 0, -1], [2.1, 1.6], (f) => {
      ctx.fillStyle = rgba(BLUE, (0.05 + scan * 0.16) * f);
      ctx.fillRect(0, 0, 2.1, 1.55);
      ctx.fillStyle = rgba(BLUE, (0.15 + scan * 0.55) * f);
      ctx.fillRect(0, ((t * 1.6) % 1) * 1.5, 2.1, 0.04);
    });

    // Junk: a piston behind the belt pushes it into a bin.
    const push = pusher.t < 0.5 ? ease(pusher.t / 0.5) : 1 - ease((pusher.t - 0.5) / 0.5);
    box(PUSHER_X - 0.7, BELT_Y - 3, 0, 1.4, 1, 1.5, GLASS_S);
    box(PUSHER_X - 0.12, BELT_Y - 2, 1.15, 0.24, 0.3 + push * 2.2, 0.24, WHITE_S);
    box(PUSHER_X - 0.5, BELT_Y - 1.75 + push * 2.2, 1.05, 1, 0.12, 0.45, JOINT_S);
    bin(PUSHER_X, 0.4, 2.6, 1.7, 0.9, "JUNK", INK, GLASS_S);

    // Label trays.
    for (const [name, x] of SORTERS)
      bin(x, TRAY_Y - 0.8, 2.5, 1.6, 0.9, name.toUpperCase(), LABELS[name]);

    // The cache: shelves of mail kept on the device.
    for (const [i, shelf] of shelves.entries()) {
      const x = CACHE[0] + i * 4.9;
      box(x, CACHE[1], 0, 4.3, 1.7, 3.9, PANE_S);
      for (const [j, stacks] of shelf.entries()) {
        const z = 0.25 + j * 1.25;
        box(x + 0.1, CACHE[1] + 0.1, z - 0.06, 4.1, 1.5, 0.06, WHITE_S);
        for (const [k, n] of stacks.entries()) {
          box(x + 0.3 + k * 1.3, CACHE[1] + 0.45, z, 1, 0.68, n * 0.07, WHITE_S);
        }
      }
    }

    // The inbox, the archive, the agent's desk.
    box(INBOX[0] - 1.4, INBOX[1] - 1.3, 0, 2.8, 2.6, 0.3, tinted(GLASS_S, BLUE));
    box(DRAWER_X - 1.8, -5.8, 0, 3.6, 3, 5.2, GLASS_S);
    for (const [i, drawer] of drawers.entries()) {
      const z = 0.3 + i * 1.22;
      const out = ease(drawer.open) * 1.4;
      box(DRAWER_X - 1.55, -5.5 + out, z, 3.1, 2.75, 1.02, PANE_S);
      box(DRAWER_X - 0.45, -2.73 + out, z + 0.62, 0.9, 0.08, 0.14, JOINT_S);
    }
    letters([DRAWER_X - 1.55, -2.79, 5.05], "ARCHIVE", 0.3, INK, 0.6, {
      down: [0, 0, -1],
      depth: project([DRAWER_X, -2.8, 4.8])[2] + 0.05,
    });
    slab(DESK[0] - 1.6, DESK[1] - 1.1, 0, 4.4, 2.2, 1.5, GLASS_S);
    letters([DESK[0] - 1.4, DESK[1] + 1.11, 1.36], "AGENT", 0.3, INK, 0.6, {
      down: [0, 0, -1],
      depth: project([DESK[0], DESK[1] + 1.1, 0.75])[2] + 0.05,
    });
    box(DESK[0] - 1.05, DESK[1] - 0.6, 1.5, 1.6, 1.3, 0.03, WHITE_S);
    agentScreen(t);

    // The front row: the keyboard, and every device showing the same inbox.
    keyboard();
    devices();
  }

  /** A glass bin with its name on the front. */
  function bin(x, y, w, d, h, name, rgb, s = tinted(GLASS_S, rgb)) {
    box(x - w / 2, y, 0, w, d, h, s);
    letters([x - w / 2 + 0.16, y + d + 0.01, 0.4], name, 0.28, rgb, 0.9, {
      down: [0, 0, -1],
      depth: project([x, y + d, h / 2])[2] + 0.05,
    });
  }

  function belt(from, to, y, z, t, dir) {
    for (let x = from; x < to; x += 4) {
      const w = Math.min(4, to - x);
      // Under whatever rides on it.
      const under = project([x + w / 2, y, z])[2] - 0.8;
      box(x, y - 0.8, z - 0.3, w, 1.6, 0.3, WHITE_S, { depth: under });
      for (const ly of [y - 0.62, y + 0.5])
        box(x + w / 2 - 0.1, ly, 0, 0.2, 0.12, z - 0.3, WHITE_S);
      plane(
        [x, y - 0.8, z],
        [1, 0, 0],
        [0, 1, 0],
        [w, 1.6],
        (f) => {
          ctx.lineWidth = 0.03;
          ctx.strokeStyle = rgba(INK, 0.22 * f);
          ctx.beginPath();
          const shift = (((t * SPEED * dir) % 0.8) + 0.8) % 0.8;
          for (let k = shift; k < w; k += 0.8) {
            ctx.moveTo(k, 0.1);
            ctx.lineTo(k, 1.5);
          }
          ctx.stroke();
        },
        under + 0.01,
      );
    }
  }

  // ── Arms: two links on a column, a rod down to the gripper ──────────────────

  const arm = (x, y, shoulder, l1, l2, rest) => ({
    x,
    y,
    shoulder,
    l1,
    l2,
    rest,
    grip: [...rest],
    moves: [],
    move: null,
    holding: null,
    open: 1,
    busy: false,
  });
  const sorters = SORTERS.map(([kind, x]) => ({
    ...arm(x, 0.55, 3, 1.75, 1.55, [x + 0.7, -0.3, 2.2]),
    kind,
  }));
  const reader = arm(17.4, -0.5, 3.3, 2.25, 2.05, [16.4, 0.7, 2.4]);

  function stepArm(a, dt) {
    if (!a.move && a.moves.length) a.move = { ...a.moves.shift(), from: [...a.grip], t: 0 };
    const m = a.move;
    if (m) {
      m.t += dt;
      const to = typeof m.to === "function" ? m.to() : m.to;
      a.grip = mix(m.from, to, ease(clamp(m.t / m.dur, 0, 1)));
      if (m.t >= m.dur) {
        a.move = null;
        m.onEnd?.();
      }
    }
    a.open = lerp(a.open, a.holding ? 0 : 1, 1 - Math.exp(-dt * 14));
    if (a.holding) Object.assign(a.holding, { x: a.grip[0], y: a.grip[1], z: a.grip[2] - 0.2 });
  }

  function drawArm(a) {
    const [tx, ty, tz] = a.grip;
    const { l1, l2 } = a;
    const d = clamp(Math.hypot(tx - a.x, ty - a.y), Math.abs(l1 - l2) + 0.02, l1 + l2 - 0.02);
    const toward = Math.atan2(ty - a.y, tx - a.x);
    const bend = Math.acos(clamp((d * d - l1 * l1 - l2 * l2) / (2 * l1 * l2), -1, 1));
    const t1 = toward - Math.atan2(l2 * Math.sin(bend), l1 + l2 * Math.cos(bend));
    const elbow = [a.x + l1 * Math.cos(t1), a.y + l1 * Math.sin(t1)];
    const wrist = [elbow[0] + l2 * Math.cos(t1 + bend), elbow[1] + l2 * Math.sin(t1 + bend)];
    const z = a.shoulder;
    cylinder(a.x, a.y, 0, 0.66, 0.3, WHITE_S);
    cylinder(a.x, a.y, 0.3, 0.3, z - 0.6, WHITE_S);
    cylinder(a.x, a.y, z - 0.32, 0.44, 0.44, JOINT_S);
    link([a.x, a.y], elbow, z - 0.22, 0.46, 0.3);
    cylinder(elbow[0], elbow[1], z - 0.56, 0.34, 0.64, WHITE_S);
    link(elbow, wrist, z - 0.52, 0.38, 0.26);
    cylinder(wrist[0], wrist[1], z - 0.66, 0.24, 0.42, JOINT_S);
    const gz = tz + 0.02;
    box(
      wrist[0] - 0.07,
      wrist[1] - 0.07,
      gz + 0.24,
      0.14,
      0.14,
      Math.max(0.05, z - 0.66 - gz - 0.24),
      WHITE_S,
    );
    box(wrist[0] - 0.36, wrist[1] - 0.16, gz + 0.12, 0.72, 0.32, 0.12, JOINT_S);
    for (const side of [-1, 1]) {
      box(
        wrist[0] + side * (0.3 + a.open * 0.14) - 0.04,
        wrist[1] - 0.12,
        gz - 0.06,
        0.08,
        0.24,
        0.2,
        WHITE_S,
      );
    }
  }

  function link(from, to, z, width, height) {
    const dx = to[0] - from[0];
    const dy = to[1] - from[1];
    const len = Math.hypot(dx, dy) || 1;
    const side = [(-dy / len) * width, (dx / len) * width, 0];
    block(
      [from[0] - side[0] / 2, from[1] - side[1] / 2, z],
      [dx, dy, 0],
      side,
      [0, 0, height],
      WHITE_S,
    );
  }

  // ── The mail ────────────────────────────────────────────────────────────────

  let mails = [];
  let pings = [];
  let rows = [];
  let timers = [];
  let now = 0;
  let scan = 0;
  let nextSpawn = 0;
  let fromGmail = true;
  let nextId = 1;
  let drawerTurn = 0;
  let readerRest = 0;
  const trays = { northwind: [], hiring: [], finance: [], junk: [] };
  const shelves = Array.from({ length: 5 }, () =>
    Array.from({ length: 3 }, () => Array.from({ length: 3 }, () => 2 + Math.floor(random() * 9))),
  );
  const pile = [];
  const drawers = [{ open: 0 }, { open: 0 }, { open: 0 }, { open: 0 }];
  const pusher = { t: 1 };
  const keys = new Map();
  const agent = { mail: null, t: 0, reply: null };

  const after = (delay, fn) => timers.push({ at: now + delay, fn });
  const press = (key) => keys.set(key, now);
  const row = (id, avatar, unread) => ({
    id,
    avatar,
    unread,
    w1: 0.35 + random() * 0.25,
    w2: 0.55 + random() * 0.35,
    y: -1,
    a: 0,
  });
  // What's already in the inbox, read.
  for (let i = 0; i < 9; i++)
    rows.push({ ...row(-i, AVATARS[i % AVATARS.length], false), y: i, a: 1 });

  function spawn() {
    const roll = random();
    const kind =
      roll < 0.44
        ? "inbox"
        : roll < 0.58
          ? "northwind"
          : roll < 0.71
            ? "hiring"
            : roll < 0.84
              ? "finance"
              : "junk";
    mails.push({
      id: nextId++,
      kind,
      state: "tube",
      tube: fromGmail ? TUBES.gmail : TUBES.imap,
      t: 0,
      x: 0,
      y: 0,
      z: 0,
      yaw: 0,
      alpha: 1,
      avatar: AVATARS[Math.floor(random() * AVATARS.length)],
    });
    fromGmail = !fromGmail;
    pings.push(now);
    pings = pings.filter((p) => now - p < 2);
  }

  function update(dt) {
    now += dt;
    for (const timer of timers.filter((tm) => tm.at <= now)) timer.fn();
    timers = timers.filter((tm) => tm.at > now);

    if (now >= nextSpawn) {
      spawn();
      nextSpawn = now + 1.5 + random() * 0.6;
    }

    for (const m of mails) {
      if (m.state === "tube" || m.state === "send") {
        m.t += dt / (m.state === "tube" ? 1.2 : 1.6);
        [m.x, m.y, m.z] = along(m.tube, ease(m.t));
        if (m.t < 1) continue;
        if (m.state === "send") m.gone = true;
        else Object.assign(m, { state: "belt", x: BELT_START + 0.6, y: BELT_Y, z: BELT_Z });
      } else if (m.state === "belt") {
        m.x += SPEED * dt;
        if (m.kind === "junk" && m.x >= PUSHER_X && pusher.t >= 1) {
          pusher.t = 0;
          Object.assign(m, { state: "pushed", t: 0, from: [m.x, m.y, m.z] });
        } else if (m.x >= BELT_END) {
          Object.assign(m, { state: "slide", t: 0, from: [m.x, m.y, m.z] });
        }
      } else if (m.state === "pushed" || m.state === "slide" || m.state === "toBelt") {
        m.t += dt / (m.state === "pushed" ? 0.75 : 0.6);
        const to =
          m.state === "pushed"
            ? [PUSHER_X, 1.25, 0.12 + trays.junk.length * 0.07]
            : m.state === "slide"
              ? [INBOX[0], INBOX[1], 0.32 + pile.length * 0.07]
              : [DESK[0] - 0.25, OUT_Y, OUT_Z];
        const k = ease(clamp(m.t, 0, 1));
        [m.x, m.y, m.z] = mix(m.from, to, k);
        m.z += Math.sin(k * Math.PI) * (m.state === "slide" ? 0.5 : 0.35);
        if (m.t < 1) continue;
        if (m.state === "pushed") {
          m.state = "junk";
          trays.junk.push(m);
          if (trays.junk.length > 5) trays.junk.shift().gone = true;
        } else if (m.state === "slide") {
          m.state = "inbox";
          m.yaw = (random() - 0.5) * 0.3;
          m.x += (random() - 0.5) * 0.2;
          m.y += (random() - 0.5) * 0.2;
          pile.push(m);
          rows.unshift(row(m.id, m.avatar, true));
        } else {
          m.state = "out";
        }
      } else if (m.state === "out") {
        m.x -= SPEED * dt;
        if (m.x <= OUT_END) Object.assign(m, { state: "send", tube: TUBES.send, t: 0 });
      } else if (m.state === "filed") {
        m.alpha -= dt * 2.5;
        m.z -= dt * 0.4;
        if (m.alpha <= 0) m.gone = true;
      }
    }
    mails = mails.filter((m) => !m.gone);
    const reading = mails.some((m) => m.state === "belt" && Math.abs(m.x - SCANNER_X) < 0.9);
    scan = lerp(scan, reading ? 1 : 0, 1 - Math.exp(-dt * 8));
    pusher.t = Math.min(1, pusher.t + dt / 0.9);

    // The sorting arms take their label's mail off the belt.
    for (const a of sorters) {
      if (!a.busy) {
        const m = mails.find(
          (mm) =>
            mm.state === "belt" &&
            mm.kind === a.kind &&
            !mm.claimed &&
            mm.x > a.x - 2.2 &&
            mm.x < a.x,
        );
        if (m) sort(a, m);
      }
      stepArm(a, dt);
    }

    // The inbox arm: archive, or the agent.
    if (!reader.busy && pile.length >= 2 && now > readerRest) work();
    stepArm(reader, dt);

    for (const drawer of drawers)
      drawer.open = clamp(drawer.open + (drawer.opening ? dt : -dt) * 2.4, 0, 1);

    // Each device's inbox rows ease to their place.
    let slot = 0;
    for (const r of rows) {
      if (r.gone) r.a = Math.max(0, r.a - dt * 3);
      else {
        r.a = Math.min(1, r.a + dt * 2.5);
        r.slot = slot++;
      }
      r.y = lerp(r.y, r.slot ?? r.y, 1 - Math.exp(-dt * 7));
    }
    rows = rows.filter((r) => !(r.gone && r.a <= 0)).slice(0, 14);

    if (agent.mail) {
      agent.t += dt;
      if (agent.t >= 2.8 && !agent.reply) {
        agent.reply = {
          id: nextId++,
          kind: "reply",
          state: "desk",
          x: DESK[0] - 0.25,
          y: DESK[1],
          z: 1.56,
          yaw: 0,
          alpha: 0,
        };
        mails.push(agent.reply);
      }
      if (agent.reply?.state === "desk") {
        agent.reply.alpha = clamp((agent.t - 2.8) / 0.4, 0, 1);
        agent.mail.alpha = 1 - agent.reply.alpha;
        if (agent.t >= 3.4) {
          agent.mail.gone = true;
          Object.assign(agent.reply, {
            state: "toBelt",
            t: 0,
            from: [agent.reply.x, agent.reply.y, agent.reply.z],
          });
        }
      }
      if (agent.t >= 4.2) Object.assign(agent, { mail: null, reply: null, t: 0 });
    }
  }

  function sort(a, m) {
    a.busy = true;
    m.claimed = true;
    const tray = trays[a.kind];
    let grabX = 0;
    a.moves.push(
      {
        to: () => [m.x, BELT_Y, BELT_Z + 0.2],
        dur: 0.7,
        onEnd: () => {
          a.holding = m;
          m.state = "held";
          grabX = m.x;
        },
      },
      { to: () => [grabX, BELT_Y, 2.2], dur: 0.35 },
      { to: [a.x, TRAY_Y - 0.3, 2.1], dur: 0.8 },
      {
        to: () => [a.x, TRAY_Y - 0.3, 0.34 + tray.length * 0.07],
        dur: 0.35,
        onEnd: () => {
          a.holding = null;
          m.state = "tray";
          m.yaw = (random() - 0.5) * 0.25;
          tray.push(m);
          if (tray.length > 5) tray.shift().gone = true;
        },
      },
      {
        to: a.rest,
        dur: 0.6,
        onEnd: () => {
          a.busy = false;
        },
      },
    );
  }

  function work() {
    const a = reader;
    a.busy = true;
    press("J");
    const m = pile.at(-1);
    a.moves.push(
      {
        to: () => [m.x, m.y, m.z + 0.2],
        dur: 0.65,
        onEnd: () => {
          pile.pop();
          a.holding = m;
          m.state = "held";
          m.yaw = 0;
          const r = rows.find((rr) => rr.id === m.id);
          if (r) r.unread = false;
        },
      },
      {
        to: () => [m.x, m.y, 2.7],
        dur: 0.35,
        onEnd: () => {
          if (agent.mail || random() < 0.55) archive(m);
          else reply(m);
        },
      },
    );
  }

  const done = (rest) => ({
    to: reader.rest,
    dur: 0.6,
    onEnd: () => {
      reader.busy = false;
      readerRest = now + rest;
    },
  });

  function archive(m) {
    const drawer = drawers[drawerTurn++ % 2];
    const z = 0.3 + drawers.indexOf(drawer) * 1.22 + 1.02;
    press("E");
    drawer.opening = true;
    reader.moves.push(
      { to: [DRAWER_X, -2.2, Math.min(z + 0.7, 2.5)], dur: 0.8 },
      {
        to: [DRAWER_X, -2.2, z + 0.25],
        dur: 0.3,
        onEnd: () => {
          reader.holding = null;
          m.state = "filed";
          const r = rows.find((rr) => rr.id === m.id);
          if (r) r.gone = true;
          after(0.35, () => {
            drawer.opening = false;
          });
        },
      },
      done(0.4),
    );
  }

  function reply(m) {
    press("R");
    reader.moves.push(
      { to: [DESK[0] - 0.25, DESK[1], 2.4], dur: 0.85 },
      {
        to: [DESK[0] - 0.25, DESK[1], 1.76],
        dur: 0.3,
        onEnd: () => {
          reader.holding = null;
          m.state = "desk";
          Object.assign(agent, { mail: m, t: 0, reply: null });
        },
      },
      done(0.5),
    );
  }

  function envelope(m) {
    if (m.alpha <= 0) return;
    const a = [Math.cos(m.yaw) * 1.15, Math.sin(m.yaw) * 1.15, 0];
    const b = [-Math.sin(m.yaw) * 0.78, Math.cos(m.yaw) * 0.78, 0];
    const o = [m.x - a[0] / 2 - b[0] / 2, m.y - a[1] / 2 - b[1] / 2, m.z];
    // In a tube, over the tube's glass.
    const depth = m.state === "tube" || m.state === "send" ? m.tube.depth + 0.01 : undefined;
    block(o, a, b, [0, 0, 0.05], m.kind === "junk" ? JUNK_S : WHITE_S, { alpha: m.alpha, depth });
    plane(
      add(o, [0, 0, 0.05]),
      mul(a, 0.01),
      mul(b, 1 / 68),
      [100, 68],
      (f) => {
        const alpha = m.alpha * f;
        ctx.lineWidth = 2.4;
        ctx.strokeStyle = rgba(INK, 0.45 * alpha);
        ctx.beginPath();
        ctx.moveTo(3, 3);
        ctx.lineTo(50, 40);
        ctx.lineTo(97, 3);
        ctx.stroke();
        const rgb = LABELS[m.kind] ?? (m.kind === "reply" ? BLUE : null);
        if (rgb) {
          ctx.fillStyle = rgba(rgb, 0.9 * alpha);
          ctx.fillRect(76, 48, 14, 12);
        }
        if (m.state === "inbox" || m.state === "slide") {
          ctx.fillStyle = rgba(BLUE, 0.95 * alpha);
          ctx.beginPath();
          ctx.arc(14, 54, 6, 0, Math.PI * 2);
          ctx.fill();
        }
      },
      depth && depth + 0.01,
    );
  }

  // ── The agent, the keyboard, the devices ────────────────────────────────────

  function agentScreen(t) {
    const o = [DESK[0] + 0.35, DESK[1] - 0.95, 2];
    const up = [0, -0.25, 1.6];
    box(o[0] + 1, o[1] + 0.2, 1.5, 0.3, 0.3, 0.5, WHITE_S);
    block(o, [2.3, 0, 0], [0, 0.1, 0], up, WHITE_S);
    const fall = mul(up, -1.5 / 160 / Math.hypot(...up));
    plane(add(add(o, [0.1, 0.1, 0]), mul(up, 0.96)), [0.021, 0, 0], fall, [100, 160], (f) => {
      ctx.fillStyle = rgba("248, 250, 253", f);
      ctx.fillRect(0, 0, 100, 158);
      const k = agent.mail ? agent.t : 0;
      // The question, then the answer streaming in.
      ctx.fillStyle = rgba(INK, 0.12 * clamp((k - 0.1) / 0.3, 0, 1) * f);
      roundRect(40, 10, 54, 22, 8);
      ctx.fill();
      [80, 64, 86, 50, 74, 40].forEach((w, i) => {
        const p = clamp((k - 0.5 - i * 0.35) / 0.35, 0, 1);
        if (p <= 0) return;
        ctx.fillStyle = rgba(INK, 0.32 * f);
        ctx.fillRect(8, 44 + i * 14, w * p, 6);
      });
      if (agent.mail && k < 2.8) {
        ctx.fillStyle = rgba(BLUE, (0.5 + 0.5 * Math.sin(t * 8)) * f);
        ctx.fillRect(8, 134, 8, 8);
      }
    });
  }

  const KEYS = [
    ["Q", "W", "E", "R", "T", "Y", "U", "I"],
    ["A", "S", "D", "F", "G", "H", "J", "K"],
    ["⌘", "Z", "X", "C", "V", "B", "N", "M"],
  ];

  function keyboard() {
    const x0 = 5.8;
    const y0 = FRONT + 0.6;
    slab(x0 - 0.8, FRONT, 0, 8.4, 3.6, 0.45, GLASS_S);
    slab(x0 - 0.3, y0 - 0.3, 0.45, 7.8, 3, 0.14, WHITE_S);
    KEYS.forEach((keyRow, r) => {
      keyRow.forEach((key, i) => {
        const x = x0 + r * 0.32 + i * 0.9;
        const y = y0 + r * 0.9;
        const since = now - (keys.get(key) ?? -9);
        const down = since < 0.35 ? Math.sin((since / 0.35) * Math.PI) : 0;
        const z = 0.59 - down * 0.12;
        const used = "ERJK⌘".includes(key);
        block([x, y, z], [0.76, 0, 0], [0, 0.72, 0], [0, 0, 0.24], down > 0 ? KEY_S : WHITE_S);
        plane([x, y, z + 0.24], [0.076, 0, 0], [0, 0.072, 0], [10, 10], (f) => {
          ctx.font = `600 5px ${SANS}`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillStyle = rgba(down > 0 ? BLUE : INK, (used ? 0.75 : 0.35) * f);
          ctx.fillText(key, 5, 5.3);
        });
      });
    });
    plinthLabel(x0 + 2.7, "KEYBOARD");
  }

  function devices() {
    // The Mac: a laptop.
    const lx = -16.6;
    slab(lx - 0.8, FRONT, 0, 6.4, 3.6, 0.5, GLASS_S);
    slab(lx, FRONT + 1.3, 0.5, 4.8, 2.1, 0.12, WHITE_S);
    const lid = [0, -0.55, 3];
    const hinge = [lx, FRONT + 1.3, 0.62];
    block(hinge, [4.8, 0, 0], [0, 0.08, 0], lid, WHITE_S);
    screen(
      add(add(hinge, [0.2, 0.09, 0]), mul(lid, 0.95)),
      [1, 0, 0],
      mul(lid, -1 / Math.hypot(...lid)),
      4.4,
      2.6,
      "mac",
    );
    plinthLabel(lx + 1.4, "MAC");

    // The web: a browser window on a stand.
    const bx = -8.4;
    slab(bx - 0.6, FRONT, 0, 6.4, 3.6, 0.5, GLASS_S);
    box(bx + 2.3, FRONT + 1.9, 0.5, 0.6, 0.4, 0.7, WHITE_S);
    block([bx, FRONT + 2, 1.2], [5.2, 0, 0], [0, 0.1, 0], [0, 0, 3.3], WHITE_S);
    screen([bx + 0.15, FRONT + 2.11, 4.35], [1, 0, 0], [0, 0, -1], 4.9, 3, "web");
    plinthLabel(bx + 1.8, "WEB");

    // The iPhone, on a dock.
    const ix = 0.6;
    const face = [0, -0.2, 3.5];
    slab(ix - 1.4, FRONT, 0, 4.6, 3.6, 0.5, GLASS_S);
    box(ix - 0.1, FRONT + 1.8, 0.5, 2, 0.8, 0.3, WHITE_S);
    block([ix, FRONT + 2.05, 0.8], [1.8, 0, 0], [0, 0.14, 0], face, WHITE_S);
    screen(
      add([ix + 0.1, FRONT + 2.2, 0.8], mul(face, 0.97)),
      [1, 0, 0],
      mul(face, -1 / Math.hypot(...face)),
      1.6,
      3.3,
      "phone",
    );
    plinthLabel(ix - 0.4, "IPHONE");
  }

  function plinthLabel(x, text) {
    letters([x, FRONT + 3.61, 0.36], text, 0.36, INK, 0.5, {
      down: [0, 0, -1],
      depth: project([x, FRONT + 3.6, 0.25])[2] + 0.1,
    });
  }

  /** A device's screen: its own frame, and the inbox rows every device shares. */
  function screen(o, right, down, w, h, kind) {
    plane(o, mul(right, 0.01), mul(down, 0.01), [w * 100, h * 100], (f) => {
      const W = w * 100;
      const H = h * 100;
      ctx.fillStyle = rgba("250, 251, 253", f);
      ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = rgba(INK, 0.2 * f);
      ctx.lineWidth = 1.2;
      ctx.strokeRect(0, 0, W, H);
      let left = 0;
      let top = 0;
      if (kind === "mac") {
        // The rail of mailboxes, then the list.
        ctx.fillStyle = rgba(INK, 0.05 * f);
        ctx.fillRect(0, 0, 22, H);
        AVATARS.slice(0, 3).forEach((rgb, i) => {
          ctx.fillStyle = rgba(rgb, 0.7 * f);
          roundRect(6, 10 + i * 18, 10, 10, 3);
          ctx.fill();
        });
        left = 22;
        top = 14;
      } else if (kind === "web") {
        ctx.fillStyle = rgba(INK, 0.05 * f);
        ctx.fillRect(0, 0, W, 22);
        for (let i = 0; i < 3; i++) {
          ctx.fillStyle = rgba(INK, 0.18 * f);
          ctx.beginPath();
          ctx.arc(10 + i * 9, 11, 3, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = rgba(INK, 0.08 * f);
        roundRect(W / 2 - 80, 5, 160, 12, 6);
        ctx.fill();
        top = 30;
      } else {
        ctx.fillStyle = rgba(INK, 0.85 * f);
        roundRect(W / 2 - 22, 8, 44, 12, 6);
        ctx.fill();
        ctx.fillStyle = rgba(INK, 0.6 * f);
        ctx.fillRect(10, 34, 50, 10);
        top = 54;
      }
      if (kind !== "phone") {
        ctx.fillStyle = rgba(INK, 0.55 * f);
        ctx.fillRect(left + 10, top, 40, 7);
        top += 16;
      }
      const rowH = kind === "phone" ? 34 : 30;
      ctx.save();
      ctx.beginPath();
      ctx.rect(left, top, W - left, H - top);
      ctx.clip();
      for (const r of rows) {
        const y = top + r.y * rowH;
        if (y > H) continue;
        const a = r.a * f;
        const inner = W - left - 46;
        ctx.fillStyle = rgba(r.avatar, 0.75 * a);
        ctx.beginPath();
        ctx.arc(left + 26, y + rowH / 2, 7, 0, Math.PI * 2);
        ctx.fill();
        if (r.unread) {
          ctx.fillStyle = rgba(BLUE, a);
          ctx.beginPath();
          ctx.arc(left + 10, y + rowH / 2, 3, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = rgba(INK, (r.unread ? 0.7 : 0.45) * a);
        ctx.fillRect(left + 40, y + 8, inner * r.w1, 5);
        ctx.fillStyle = rgba(INK, 0.22 * a);
        ctx.fillRect(left + 40, y + 17, inner * r.w2, 4);
        ctx.fillStyle = rgba(INK, 0.06 * a);
        ctx.fillRect(left + 8, y + rowH - 1, W - left - 16, 1);
      }
      ctx.restore();
    });
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
  }

  // ── Running it ──────────────────────────────────────────────────────────────

  function draw() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    queue = [];
    room(now);
    for (const a of [...sorters, reader]) drawArm(a);
    for (const m of mails) envelope(m);
    queue.sort((p, q) => p.depth - q.depth);
    ctx.lineWidth = px;
    ctx.lineJoin = "round";
    for (const item of queue) item.draw();
  }

  function resize() {
    px = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    canvas.width = Math.round(w * px);
    canvas.height = Math.round(h * px);
    u = Math.max(w / 48, 15) * px;
    // The middle of the room, a little below the middle of the canvas.
    ox = 0;
    oy = 0;
    const [fx, fy] = project([2, 2.2, 1.5]);
    ox = canvas.width / 2 - fx;
    oy = canvas.height * 0.55 - fy;
    draw();
  }

  // Start with the room already busy.
  for (let i = 0; i < 40 * 30; i++) update(1 / 30);

  let playing = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let visible = true;
  let last = 0;
  let frame = 0;

  function tick(time) {
    frame = 0;
    update(last ? Math.min(0.05, (time - last) / 1000) : 0);
    last = time;
    draw();
    schedule();
  }
  function schedule() {
    if (!playing || !visible || document.hidden) last = 0;
    else if (!frame) frame = requestAnimationFrame(tick);
  }
  function setPlaying(next) {
    playing = next;
    toggle.textContent = playing ? "Pause" : "Play";
    toggle.setAttribute("aria-pressed", String(!playing));
    if (!playing && frame) {
      cancelAnimationFrame(frame);
      frame = 0;
    }
    schedule();
  }

  toggle.addEventListener("click", () => setPlaying(!playing));
  new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    schedule();
  }).observe(canvas);
  document.addEventListener("visibilitychange", schedule);
  new ResizeObserver(resize).observe(canvas);
  resize();
  setPlaying(playing);
})();
