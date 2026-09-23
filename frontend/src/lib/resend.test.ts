import { describe, it, expect, vi, beforeEach } from "vitest";

// Resend simulé : chaque test choisit si l'API accepte ou refuse (429).
const resendMock = vi.hoisted(() => ({
  emailsSend: vi.fn(),
  batchSend: vi.fn(),
}));

vi.mock("resend", () => ({
  Resend: class {
    emails = { send: resendMock.emailsSend };
    batch = { send: resendMock.batchSend };
  },
}));

import { sendResultEmails, sendPasswordResetEmail } from "./resend";

const rateLimited = { data: null, error: { name: "rate_limit_exceeded", message: "429" } };

function items(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    key: `c${i}`,
    email: `c${i}@audencia.com`,
    firstName: `C${i}`,
    admis: true,
    tour: 1,
    message: "ok",
  }));
}

describe("secours Brevo", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    resendMock.emailsSend.mockReset();
    resendMock.batchSend.mockReset();
    fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    process.env.BREVO_API_KEY = "xkeysib-test";
    process.env.BREVO_FROM_EMAIL = "noreply@test.fr";
  });

  async function run<T>(p: Promise<T>) {
    await vi.runAllTimersAsync();
    return p;
  }

  it("n'appelle pas Brevo quand Resend accepte", async () => {
    resendMock.batchSend.mockResolvedValue({ data: {}, error: null });
    const r = await run(sendResultEmails(items(12)));
    expect(r).toEqual({ sent: 12, failedKeys: [] });
    expect(resendMock.batchSend).toHaveBeenCalledTimes(2); // lots de 10
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("relaie un lot refusé par Resend vers Brevo, mail par mail", async () => {
    resendMock.batchSend.mockResolvedValue(rateLimited);
    const r = await run(sendResultEmails(items(3)));
    expect(r).toEqual({ sent: 3, failedKeys: [] });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.to).toEqual([{ email: "c0@audencia.com" }]);
    expect(body.subject).toContain("Résultat du tour 1");
  });

  it("remonte en échec seulement les mails refusés par les deux", async () => {
    resendMock.batchSend.mockResolvedValue(rateLimited);
    fetchMock
      .mockResolvedValueOnce(new Response("{}", { status: 201 }))
      .mockResolvedValueOnce(new Response("quota", { status: 402 }));
    const r = await run(sendResultEmails(items(2)));
    expect(r).toEqual({ sent: 1, failedKeys: ["c1"] });
  });

  it("sans clé Brevo, l'échec Resend remonte comme avant", async () => {
    delete process.env.BREVO_API_KEY;
    resendMock.emailsSend.mockResolvedValue(rateLimited);
    await expect(run(sendPasswordResetEmail("a@b.fr", "A", "tok"))).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("un envoi unitaire refusé par Resend part par Brevo", async () => {
    resendMock.emailsSend.mockResolvedValue(rateLimited);
    const r = await run(sendPasswordResetEmail("a@b.fr", "A", "tok"));
    expect(r.via).toBe("brevo");
  });
});
