/** Auth login-lockout unit tests — no DB, no network. */
import * as bcrypt from "bcryptjs";
import { AuthService } from "../src/auth/auth.service";

describe("AuthService login lockout", () => {
  async function makeService() {
    const hash = await bcrypt.hash("rightpass", 4);
    const fakePrisma = { user: { findUnique: async () => ({ id: "u1", passwordHash: hash }) } };
    const fakeJwt = { sign: () => "tok" };
    return new AuthService(fakePrisma as any, fakeJwt as any);
  }

  it("allows login with correct password and resets", async () => {
    const svc = await makeService();
    await expect(svc.login("a@x.com", "wrong")).rejects.toMatchObject({ status: 401 });
    const ok = await svc.login("a@x.com", "rightpass");
    expect(ok).toEqual({ accessToken: "tok" });
  });

  it("locks the email for 15min after 5 failures (429), even for the right password", async () => {
    const svc = await makeService();
    for (let i = 0; i < 4; i++) {
      await expect(svc.login("b@x.com", "wrong")).rejects.toMatchObject({ status: 401 });
    }
    // 5th failure trips the lock → 429 instead of 401.
    await expect(svc.login("b@x.com", "wrong")).rejects.toMatchObject({ status: 429 });
    // Correct password is still rejected while locked (no oracle for attackers).
    await expect(svc.login("b@x.com", "rightpass")).rejects.toMatchObject({ status: 429 });
  });

  it("unknown emails get 401 (no user enumeration via status)", async () => {
    const fakePrisma = { user: { findUnique: async () => null } };
    const svc = new AuthService(fakePrisma as any, { sign: () => "tok" } as any);
    await expect(svc.login("ghost@x.com", "whatever")).rejects.toMatchObject({ status: 401 });
  });
});
