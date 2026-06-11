import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { PermissionsModal } from "./PermissionsModal";

vi.mock("@/lib/permissionsApi", () => ({
  listPermissions: vi.fn(),
  grantPermission: vi.fn(),
  revokePermission: vi.fn(),
}));

import * as api from "@/lib/permissionsApi";
const listMock = vi.mocked(api.listPermissions);
const grantMock = vi.mocked(api.grantPermission);
const revokeMock = vi.mocked(api.revokePermission);

function createWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={qc}>
        <TooltipProvider>{children}</TooltipProvider>
      </QueryClientProvider>
    );
  };
}

beforeEach(() => {
  listMock.mockReset();
  grantMock.mockReset();
  revokeMock.mockReset();
});

afterEach(cleanup);

describe("PermissionsModal", () => {
  it("fetches and displays grants when opened", async () => {
    listMock.mockResolvedValue([
      { user_id: "alice@example.com", conversation_id: "conv_abc", level: 3 },
      { user_id: "bob@example.com", conversation_id: "conv_abc", level: 1 },
    ]);

    render(<PermissionsModal sessionId="conv_abc" open={true} onOpenChange={() => {}} />, {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(screen.getByText("alice@example.com")).toBeInTheDocument();
      expect(screen.getByText("bob@example.com")).toBeInTheDocument();
    });
    expect(listMock).toHaveBeenCalledWith("conv_abc");
  });

  it("calls grantPermission with the form values on submit", async () => {
    listMock.mockResolvedValue([]);
    grantMock.mockResolvedValue({ user_id: "carol", conversation_id: "conv_abc", level: 2 });

    render(<PermissionsModal sessionId="conv_abc" open={true} onOpenChange={() => {}} />, {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(listMock).toHaveBeenCalled());

    const input = screen.getByPlaceholderText("alice@example.com");
    fireEvent.change(input, { target: { value: "carol@example.com" } });

    const grantBtn = screen.getByRole("button", { name: /grant/i });
    fireEvent.click(grantBtn);

    await waitFor(() => {
      expect(grantMock).toHaveBeenCalledWith("conv_abc", "carol@example.com", 1);
    });
  });

  it("calls revokePermission when the revoke button is clicked", async () => {
    listMock.mockResolvedValue([
      { user_id: "bob@example.com", conversation_id: "conv_abc", level: 1 },
    ]);
    revokeMock.mockResolvedValue(undefined);

    render(<PermissionsModal sessionId="conv_abc" open={true} onOpenChange={() => {}} />, {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(screen.getByText("bob@example.com")).toBeInTheDocument());

    const revokeBtn = screen.getByRole("button", { name: /revoke/i });
    fireEvent.click(revokeBtn);

    await waitFor(() => {
      expect(revokeMock).toHaveBeenCalledWith("conv_abc", "bob@example.com");
    });
  });

  it("updates a grant's level inline via grantPermission (no revoke + re-add)", async () => {
    listMock.mockResolvedValue([
      { user_id: "bob@example.com", conversation_id: "conv_abc", level: 1 },
    ]);
    grantMock.mockResolvedValue({
      user_id: "bob@example.com",
      conversation_id: "conv_abc",
      level: 2,
    });

    render(<PermissionsModal sessionId="conv_abc" open={true} onOpenChange={() => {}} />, {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(screen.getByText("bob@example.com")).toBeInTheDocument());

    // The row's permission dropdown shows the current level ("Read") as a
    // combobox; the grant form's level select also shows "Read", so disambiguate
    // by picking the combobox inside bob's row.
    const rowTrigger = screen.getAllByRole("combobox").find((el) => el.textContent === "Read")!;
    rowTrigger.focus();
    fireEvent.keyDown(rowTrigger, { key: "Enter" });
    fireEvent.click(await screen.findByRole("option", { name: "Edit" }));

    await waitFor(() => {
      expect(grantMock).toHaveBeenCalledWith("conv_abc", "bob@example.com", 2);
    });
    // Editing the level must never delete the existing grant.
    expect(revokeMock).not.toHaveBeenCalled();
  });

  it("renders the owner as non-editable with no revoke control", async () => {
    listMock.mockResolvedValue([
      { user_id: "owner@example.com", conversation_id: "conv_abc", level: 4 },
      { user_id: "bob@example.com", conversation_id: "conv_abc", level: 1 },
    ]);

    render(<PermissionsModal sessionId="conv_abc" open={true} onOpenChange={() => {}} />, {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(screen.getByText("owner@example.com")).toBeInTheDocument());

    // Owner level is fixed text, not a dropdown, and exposes no revoke button.
    expect(screen.getByText("Owner")).toBeInTheDocument();
    const revokeButtons = screen.queryAllByRole("button", { name: /revoke/i });
    expect(revokeButtons).toHaveLength(1); // only bob's row is revocable
    // Exactly one editable permission dropdown (bob); owner has none.
    expect(screen.getAllByRole("combobox")).toHaveLength(2); // bob's row + grant form
  });

  it("toggles public access via grant/revoke of __public__ sentinel", async () => {
    listMock.mockResolvedValue([]);
    grantMock.mockResolvedValue({ user_id: "__public__", conversation_id: "conv_abc", level: 1 });

    render(<PermissionsModal sessionId="conv_abc" open={true} onOpenChange={() => {}} />, {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(listMock).toHaveBeenCalled());

    const toggle = screen.getByRole("switch");
    fireEvent.click(toggle);

    await waitFor(() => {
      expect(grantMock).toHaveBeenCalledWith("conv_abc", "__public__", 1);
    });
  });

  it("displays server error messages from failed grant", async () => {
    listMock.mockResolvedValue([]);
    grantMock.mockRejectedValue(new Error("'rice' needs manage permission"));

    render(<PermissionsModal sessionId="conv_abc" open={true} onOpenChange={() => {}} />, {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(listMock).toHaveBeenCalled());

    const input = screen.getByPlaceholderText("alice@example.com");
    fireEvent.change(input, { target: { value: "rice" } });
    fireEvent.click(screen.getByRole("button", { name: /grant/i }));

    await waitFor(() => {
      expect(screen.getByText("'rice' needs manage permission")).toBeInTheDocument();
    });
  });

  it("does not fetch permissions when closed", () => {
    render(<PermissionsModal sessionId="conv_abc" open={false} onOpenChange={() => {}} />, {
      wrapper: createWrapper(),
    });
    expect(listMock).not.toHaveBeenCalled();
  });

  // Regression: the copy-link button used to copy window.location.href, so
  // sharing from the sidebar 3-dot menu always produced a link to whatever
  // conversation was currently open instead of the one being shared.
  it("copies a link to the shared conversation, not the currently open one", async () => {
    listMock.mockResolvedValue([]);
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const originalLocation = window.location;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        ...originalLocation,
        origin: "https://app.example.com",
        href: "https://app.example.com/c/conv_currently_open",
      },
    });

    try {
      render(
        <PermissionsModal sessionId="conv_being_shared" open={true} onOpenChange={() => {}} />,
        { wrapper: createWrapper() },
      );

      await waitFor(() => expect(listMock).toHaveBeenCalled());

      fireEvent.click(screen.getByRole("button", { name: /copy link/i }));

      await waitFor(() => {
        expect(writeText).toHaveBeenCalledWith("https://app.example.com/c/conv_being_shared");
      });
    } finally {
      Object.defineProperty(window, "location", { configurable: true, value: originalLocation });
    }
  });
});
