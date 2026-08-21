import { afterEach, describe, expect, it } from "vitest";
import { canonicalHost, isForeignHost } from "@/middleware";

const CANON = "heykels-7rukekvm3a-uc.a.run.app";

const h = (host: string | null, forwarded?: string) => {
  const headers = new Headers();
  if (host) headers.set("host", host);
  if (forwarded) headers.set("x-forwarded-host", forwarded);
  return headers;
};

afterEach(() => {
  delete process.env.AUTH_URL;
});

describe("canonical-host redirect decision", () => {
  it("redirects the secondary Cloud Run URL", () => {
    expect(isForeignHost(h("heykels-484024024830.us-central1.run.app"), CANON)).toBe(true);
  });

  it("NEVER redirects the canonical host to itself", () => {
    // The regression that took the site down: the decision must come from the
    // forwarded headers, because the URL Next sees inside Cloud Run is the
    // container-internal 0.0.0.0:8080 on every request, canonical ones included.
    expect(isForeignHost(h(CANON), CANON)).toBe(false);
    expect(isForeignHost(h(CANON.toUpperCase()), CANON)).toBe(false);
    expect(isForeignHost(h("0.0.0.0:8080", CANON), CANON)).toBe(false);
  });

  it("prefers x-forwarded-host over host", () => {
    expect(isForeignHost(h("0.0.0.0:8080", "heykels-484024024830.us-central1.run.app"), CANON)).toBe(true);
  });

  it("stands down without a canonical host or without headers", () => {
    expect(isForeignHost(h("anything.example"), null)).toBe(false);
    expect(isForeignHost(h(null), CANON)).toBe(false);
  });

  it("derives the canonical host from AUTH_URL and survives junk", () => {
    process.env.AUTH_URL = `https://${CANON}`;
    expect(canonicalHost()).toBe(CANON);
    process.env.AUTH_URL = "not a url";
    expect(canonicalHost()).toBeNull();
  });
});
