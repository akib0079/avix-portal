import assert from "node:assert/strict";
import { test } from "node:test";
import {
  adminRecordText,
  browserSummary,
  shortHash,
  signatureConsentText,
} from "./signature-rules";

test("the consent names the company the signer signs for, when there is one", () => {
  assert.equal(
    signatureConsentText("Verdant Skincare "),
    "I agree to sign electronically. My electronic signature is legally binding, the same as a handwritten one, and I have authority to sign on behalf of Verdant Skincare.",
  );
  assert.match(signatureConsentText(""), /I have authority to sign this agreement\.$/);
  assert.match(signatureConsentText(null), /I have authority to sign this agreement\.$/);
  assert.match(adminRecordText(" Jane Cooper "), /^Recorded by Avix Digital on behalf of Jane Cooper, /);
});

test("user agents read out as browser and system", () => {
  const cases: [string, string][] = [
    [
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
      "Chrome 130 on macOS",
    ],
    [
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1",
      "Safari 18 on iOS",
    ],
    [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0",
      "Firefox 132 on Windows",
    ],
    [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.2849.68",
      "Edge 130 on Windows",
    ],
    [
      "Mozilla/5.0 (Linux; Android 14; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36",
      "Samsung Internet 26 on Android",
    ],
    [
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0.6723.90 Mobile/15E148 Safari/604.1",
      "Chrome 130 on iOS",
    ],
  ];
  for (const [ua, expected] of cases) assert.equal(browserSummary(ua), expected);
  assert.equal(browserSummary(null), null);
  assert.equal(browserSummary("curl/8.4.0"), "Unknown browser");
});

test("a short hash keeps both ends", () => {
  const hash = "3f2a9c1e7b04d6e5a1b2c3d4e5f60718293a4b5c6d7e8f9001122334455d81ab";
  assert.equal(shortHash(hash), "3f2a9c1e7b04…5d81ab");
  assert.equal(shortHash("abc"), "abc");
});
