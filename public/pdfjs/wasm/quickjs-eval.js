/* THIS FILE IS GENERATED - DO NOT EDIT */
async function QuickJS(moduleArg = {}) {
  let moduleRtn;
  const e = moduleArg;
  const aa = import.meta.url;
  let h = "";
  let m;
  try {
    h = new URL(".", aa).href;
  } catch {}
  m = async (a) => {
    a = await fetch(a, { credentials: "same-origin" });
    if (a.ok) {
      return a.arrayBuffer();
    }
    throw new Error(`${a.status} : ${a.url}`);
  };
  let q = console.error.bind(console);
  let r;
  let t = !1;
  let u;
  let v;
  let w;
  let x = !1;
  function y() {
    const a = z.buffer;
    A = new Int8Array(a);
    new Int16Array(a);
    B = new Uint8Array(a);
    new Uint16Array(a);
    C = new Int32Array(a);
    D = new Uint32Array(a);
    new Float32Array(a);
    new Float64Array(a);
    new BigInt64Array(a);
    new BigUint64Array(a);
  }
  function E(a) {
    e.onAbort?.(a);
    a = `Aborted(${a})`;
    q(a);
    t = !0;
    a = new WebAssembly.RuntimeError(
      `${a}. Build with -sASSERTIONS for more info.`
    );
    w?.(a);
    throw a;
  }
  let F;
  async function ba(a) {
    if (!r) {
      try {
        const b = await m(a);
        return new Uint8Array(b);
      } catch {}
    }
    if (a == F && r) {
      a = new Uint8Array(r);
    } else {
      throw "both async and sync fetching of the wasm failed";
    }
    return a;
  }
  async function ca(a, b) {
    try {
      const c = await ba(a);
      return await WebAssembly.instantiate(c, b);
    } catch (error) {
      (q(`failed to asynchronously prepare wasm: ${error}`), E(error));
    }
  }
  async function da(a) {
    const b = F;
    if (!r) {
      try {
        const c = fetch(b, { credentials: "same-origin" });
        return await WebAssembly.instantiateStreaming(c, a);
      } catch (error) {
        (q(`wasm streaming compile failed: ${error}`),
          q("falling back to ArrayBuffer instantiation"));
      }
    }
    return ca(b, a);
  }
  class G {
    name = "ExitStatus";
    constructor(a) {
      this.message = `Program terminated with exit(${a})`;
      this.status = a;
    }
  }
  let A;
  let B;
  let C;
  let D;
  const H = (a) => {
    for (; a.length > 0;) {
      a.shift()(e);
    }
  };
  const I = [];
  const J = [];
  const ea = () => {
    const a = e.preRun.shift();
    J.push(a);
  };
  let K = !0;
  let L = 0;
  const fa = [0, 31, 60, 91, 121, 152, 182, 213, 244, 274, 305, 335];
  const ha = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  const M = {};
  const N = (a) => {
    if (!(a instanceof G || a == "unwind")) {
      throw a;
    }
  };
  const O = (a) => {
    u = a;
    K || L > 0 || (e.onExit?.(a), (t = !0));
    throw new G(a);
  };
  const ia = (a) => {
    if (!t) {
      try {
        a();
      } catch (error) {
        N(error);
      } finally {
        if (!(K || L > 0)) {
          try {
            ((u = a = u), O(a));
          } catch (error) {
            N(error);
          }
        }
      }
    }
  };
  const P = (a, b, c) => {
    const d = B;
    if (c > 0) {
      c = b + c - 1;
      for (let g = 0; g < a.length; ++g) {
        const f = a.codePointAt(g);
        if (f <= 127) {
          if (b >= c) {
            break;
          }
          d[b++] = f;
        } else if (f <= 2047) {
          if (b + 1 >= c) {
            break;
          }
          d[b++] = 192 | (f >> 6);
          d[b++] = 128 | (f & 63);
        } else if (f <= 65_535) {
          if (b + 2 >= c) {
            break;
          }
          d[b++] = 224 | (f >> 12);
          d[b++] = 128 | ((f >> 6) & 63);
          d[b++] = 128 | (f & 63);
        } else {
          if (b + 3 >= c) {
            break;
          }
          d[b++] = 240 | (f >> 18);
          d[b++] = 128 | ((f >> 12) & 63);
          d[b++] = 128 | ((f >> 6) & 63);
          d[b++] = 128 | (f & 63);
          g++;
        }
      }
      d[b] = 0;
    }
  };
  const ja = new TextDecoder();
  const Q = (a) => {
    if (a) {
      for (var b = a, c = B, d = b + void 0; c[b] && !(b >= d);) {
        ++b;
      }
      a = ja.decode(B.subarray(a, b));
    } else {
      a = "";
    }
    return a;
  };
  const R = (a) => {
    for (var b = 0, c = 0; c < a.length; ++c) {
      const d = a.charCodeAt(c);
      d <= 127
        ? b++
        : d <= 2047
          ? (b += 2)
          : d >= 55_296 && d <= 57_343
            ? ((b += 4), ++c)
            : (b += 3);
    }
    return b;
  };
  const T = (a) => {
    const b = R(a) + 1;
    const c = S(b);
    c && P(a, c, b);
    return c;
  };
  function U() {}
  const la = (a, b, c, d) => {
    const g = {
      array: (k) => {
        const n = V(k.length);
        A.set(k, n);
        return n;
      },
      string: (k) => {
        let n = 0;
        if (k !== null && k !== void 0 && k !== 0) {
          n = R(k) + 1;
          const X = V(n);
          P(k, X, n);
          n = X;
        }
        return n;
      },
    };
    a = e[`_${a}`];
    const f = [];
    let p = 0;
    if (d) {
      for (let l = 0; l < d.length; l++) {
        const Y = g[c[l]];
        Y ? (p === 0 && (p = W()), (f[l] = Y(d[l]))) : (f[l] = d[l]);
      }
    }
    c = a(...f);
    return (c = (function c(k) {
      p !== 0 && ka(p);
      return b === "string" ? Q(k) : b === "boolean" ? !!k : k;
    })(c));
  };
  U = (a, b, c) => {
    a = Q(a);
    b = b === null ? [] : JSON.parse(Q(b));
    try {
      const d = e.externalCall(a, b);
      return d ? T(d) : null;
    } catch (error) {
      return ((e.HEAPU8[c] = 1), T(error.message));
    }
  };
  e.noExitRuntime && (K = e.noExitRuntime);
  e.printErr && (q = e.printErr);
  e.wasmBinary && (r = e.wasmBinary);
  if (e.preInit) {
    for (
      typeof e.preInit === "function" && (e.preInit = [e.preInit]);
      e.preInit.length > 0;
    ) {
      e.preInit.shift()();
    }
  }
  e.ccall = la;
  e.cwrap = (a, b, c, d) => {
    const g = !c || c.every((f) => f === "number" || f === "boolean");
    return b !== "string" && g && !d ? e[`_${a}`] : (...f) => la(a, b, c, f, d);
  };
  e.stringToNewUTF8 = T;
  let S;
  let V;
  let W;
  let ka;
  let ma;
  let z;
  const na = {
    a: () => {
      K = !1;
      L = 0;
    },
    b(a, b) {
      a =
        a < -9_007_199_254_740_992 || a > 9_007_199_254_740_992
          ? Number.NaN
          : Number(a);
      a = new Date(a * 1e3);
      C[b >> 2] = a.getSeconds();
      C[(b + 4) >> 2] = a.getMinutes();
      C[(b + 8) >> 2] = a.getHours();
      C[(b + 12) >> 2] = a.getDate();
      C[(b + 16) >> 2] = a.getMonth();
      C[(b + 20) >> 2] = a.getFullYear() - 1900;
      C[(b + 24) >> 2] = a.getDay();
      let c = a.getFullYear();
      C[(b + 28) >> 2] =
        ((c % 4 !== 0 || (c % 100 === 0 && c % 400 !== 0) ? ha : fa)[
          a.getMonth()
        ] +
          a.getDate() -
          1) |
        0;
      C[(b + 36) >> 2] = -(a.getTimezoneOffset() * 60);
      c = new Date(a.getFullYear(), 6, 1).getTimezoneOffset();
      const d = new Date(a.getFullYear(), 0, 1).getTimezoneOffset();
      C[(b + 32) >> 2] =
        (c != d && a.getTimezoneOffset() == Math.min(d, c)) | 0;
    },
    c: (a, b, c, d) => {
      const g = new Date().getFullYear();
      const f = new Date(g, 0, 1).getTimezoneOffset();
      g = new Date(g, 6, 1).getTimezoneOffset();
      D[a >> 2] = Math.max(f, g) * 60;
      C[b >> 2] = Number(f != g);
      b = (p) => {
        const l = Math.abs(p);
        return `UTC${p >= 0 ? "-" : "+"}${String(Math.floor(l / 60)).padStart(
          2,
          "0"
        )}${String(l % 60).padStart(2, "0")}`;
      };
      a = b(f);
      b = b(g);
      g < f ? (P(a, c, 17), P(b, d, 17)) : (P(a, d, 17), P(b, c, 17));
    },
    d: () => Date.now(),
    e: () => E(""),
    f(a, b) {
      a = Q(a);
      try {
        var c = window.JSON.parse(a);
      } catch {
        c = a;
      }
      b === 0 ? window.console.log("DUMP", c) : window.alert(a);
    },
    g: U,
    h(a) {
      a = Q(a);
      return Date.parse(a);
    },
    i: (a, b) => {
      M[a] && (clearTimeout(M[a].id), delete M[a]);
      if (!b) {
        return 0;
      }
      const c = setTimeout(() => {
        delete M[a];
        ia(() => ma(a, performance.now()));
      }, b);
      M[a] = { A: b, id: c };
      return 0;
    },
    j: (a) => {
      const b = B.length;
      a >>>= 0;
      if (a > 2_147_483_648) {
        return !1;
      }
      for (let c = 1; c <= 4; c *= 2) {
        let d = b * (1 + 0.2 / c);
        d = Math.min(d, a + 100_663_296);
        a: {
          d =
            ((Math.min(
              2_147_483_648,
              Math.ceil(Math.max(a, d) / 65_536) * 65_536
            ) -
              z.buffer.byteLength +
              65_535) /
              65_536) |
            0;
          try {
            z.grow(d);
            y();
            var g = 1;
            break a;
          } catch {}
          g = void 0;
        }
        if (g) {
          return !0;
        }
      }
      return !1;
    },
    k: O,
    l(a, b, c, d) {
      a = Q(a);
      b = Q(b);
      c = Q(c);
      c = `Quickjs -- ${a}: ${b}\n${c}`;
      d === 0 ? window.console.error(c) : window.alert(c);
    },
    m(a) {
      a = Q(a);
      window.console.log(a);
    },
  };
  let Z;
  Z = await (async function () {
    function a(c) {
      c = Z = c.exports;
      e._evalInSandbox = c.p;
      e._nukeSandbox = c.q;
      e._init = c.r;
      e._commFun = c.s;
      e._dumpMemoryUse = c.t;
      S = c.u;
      e._free = c.v;
      ma = c.w;
      ka = c.x;
      V = c.y;
      W = c.z;
      z = c.n;
      y();
      return Z;
    }
    const b = { a: na };
    if (e.instantiateWasm) {
      return new Promise((c) => {
        e.instantiateWasm(b, (d, g) => {
          c(a(d, g));
        });
      });
    }
    F ??= e.locateFile
      ? e.locateFile
        ? e.locateFile("quickjs-eval.wasm", h)
        : `${h}quickjs-eval.wasm`
      : new URL("quickjs-eval.wasm", import.meta.url).href;
    return (function Z(c) {
      return a(c.instance);
    })(await da(b));
  })();
  (function () {
    function a() {
      e.calledRun = !0;
      if (!t) {
        x = !0;
        Z.o();
        v?.(e);
        e.onRuntimeInitialized?.();
        if (e.postRun) {
          for (
            typeof e.postRun === "function" && (e.postRun = [e.postRun]);
            e.postRun.length;
          ) {
            const b = e.postRun.shift();
            I.push(b);
          }
        }
        H(I);
      }
    }
    if (e.preRun) {
      for (
        typeof e.preRun === "function" && (e.preRun = [e.preRun]);
        e.preRun.length;
      ) {
        ea();
      }
    }
    H(J);
    e.setStatus
      ? (e.setStatus("Running..."),
        setTimeout(() => {
          setTimeout(() => e.setStatus(""), 1);
          a();
        }, 1))
      : a();
  })();
  x
    ? (moduleRtn = e)
    : (moduleRtn = new Promise((a, b) => {
        v = a;
        w = b;
      }));
  return moduleRtn;
}
export default QuickJS;
