import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AssessmentPage from "./page";

const { push, sessionValue } = vi.hoisted(() => ({
  push: vi.fn(),
  sessionValue: vi.fn<(key: string) => string | null>(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

vi.mock("@/lib/session", () => ({
  SERVER_SNAPSHOT: "__SERVER_SNAPSHOT__",
  useSessionValue: sessionValue,
}));

const successfulResult = {
  assessmentStatus: "PRELIMINARY",
  rtrwh: { potentialLitresPerYear: 93_120 },
};

function fillValidForm() {
  fireEvent.change(screen.getByLabelText(/Location \/ Locality/), {
    target: { value: "Bengaluru" },
  });
  fireEvent.change(screen.getByLabelText(/Roof Area/), { target: { value: "120" } });
  fireEvent.change(screen.getByLabelText(/Roof Material/), { target: { value: "RCC" } });
  fireEvent.change(screen.getByLabelText(/Soil Type/), { target: { value: "SANDY_LOAM" } });
  fireEvent.change(screen.getByLabelText(/Groundwater Depth/), { target: { value: "8" } });
  fireEvent.change(screen.getByLabelText(/Available Ground Area/), { target: { value: "15" } });
}

beforeEach(() => {
  push.mockReset();
  sessionValue.mockReset();
  sessionValue.mockReturnValue(null);
  sessionStorage.clear();
  window.scrollTo = vi.fn();
  vi.unstubAllGlobals();
});

describe("property assessment form", () => {
  it("renders every required field with homeowner-facing choices and constraints", () => {
    render(<AssessmentPage />);

    expect(screen.getByRole("heading", { name: "Property Assessment" })).toBeInTheDocument();
    const fields = [
      /Location \/ Locality/,
      /Roof Area/,
      /Roof Material/,
      /Soil Type/,
      /Groundwater Depth/,
      /Available Ground Area/,
    ].map((label) => screen.getByLabelText(label));

    for (const field of fields) expect(field).toBeRequired();
    expect(screen.getByRole("option", { name: "RCC / Concrete" })).toHaveValue("RCC");
    expect(screen.getAllByRole("option", { name: "Don't know" })).toHaveLength(2);
    expect(screen.getByLabelText(/Roof Area/)).toHaveAttribute("min", "0.1");
    expect(screen.getByLabelText(/Groundwater Depth/)).toHaveAttribute("min", "0");
    expect(screen.getByLabelText(/Planned Monthly Rainwater Use/)).not.toBeRequired();
    expect(screen.getByLabelText(/Building Basement/)).not.toBeRequired();
    expect(screen.getByLabelText(/Recharge Water Quality Review/)).toHaveValue("NOT_VERIFIED");
  });

  it("sends optional planned monthly use when the user requests tank sizing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => successfulResult,
    }));
    render(<AssessmentPage />);
    fillValidForm();
    fireEvent.change(screen.getByLabelText(/Planned Monthly Rainwater Use/), {
      target: { value: "500" },
    });

    fireEvent.click(screen.getByRole("button", { name: /Calculate Assessment/ }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/result"));
    const request = vi.mocked(fetch).mock.calls[0][1] as RequestInit;
    expect(JSON.parse(request.body as string)).toMatchObject({
      monthlyRainwaterDemandLitres: 500,
    });
  });

  it("uses native constraints to stop an invalid form before an API request", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<AssessmentPage />);

    fireEvent.change(screen.getByLabelText(/Roof Area/), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: /Calculate Assessment/ }));

    expect(screen.getByLabelText(/Roof Area/)).toBeInvalid();
    expect(screen.getByLabelText(/Location \/ Locality/)).toBeInvalid();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("submits the exact backend request shape, blocks duplicates, and stores the result", async () => {
    let resolveRequest: ((response: Response) => void) | undefined;
    const fetchMock = vi.fn(
      () => new Promise<Response>((resolve) => {
        resolveRequest = resolve;
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<AssessmentPage />);
    fillValidForm();

    const submit = screen.getByRole("button", { name: /Calculate Assessment/ });
    fireEvent.click(submit);

    expect(submit).toBeDisabled();
    expect(submit).toHaveTextContent("Calculating assessment…");
    fireEvent.click(submit);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("http://localhost:8000/api/assessment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        location: "Bengaluru",
        roofAreaM2: 120,
        roofMaterial: "RCC",
        soilType: "SANDY_LOAM",
        groundwaterDepthM: 8,
        availableGroundAreaM2: 15,
        waterQualityStatus: "NOT_VERIFIED",
      }),
    });

    await act(async () => {
      resolveRequest?.({
        ok: true,
        json: async () => successfulResult,
      } as Response);
    });

    await waitFor(() => expect(push).toHaveBeenCalledWith("/result"));
    expect(JSON.parse(sessionStorage.getItem("rainassess-inputs") ?? "null")).toEqual({
      location: "Bengaluru",
      roofAreaM2: 120,
      roofMaterial: "RCC",
      soilType: "SANDY_LOAM",
      groundwaterDepthM: 8,
      availableGroundAreaM2: 15,
      waterQualityStatus: "NOT_VERIFIED",
    });
    expect(JSON.parse(sessionStorage.getItem("rainassess-result") ?? "null")).toEqual(
      successfulResult,
    );
  });

  it("shows a clean backend validation message and allows another submission", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ detail: [{ msg: "Value error, Roof area must be greater than 0 m²." }] }),
    }));
    render(<AssessmentPage />);
    fillValidForm();

    fireEvent.click(screen.getByRole("button", { name: /Calculate Assessment/ }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Roof area must be greater than 0 m².");
    expect(screen.getByRole("button", { name: /Calculate Assessment/ })).toBeEnabled();
    expect(push).not.toHaveBeenCalled();
  });

  it("shows a safe message when the API request fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    render(<AssessmentPage />);
    fillValidForm();

    fireEvent.click(screen.getByRole("button", { name: /Calculate Assessment/ }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Failed to fetch");
    expect(alert).not.toHaveTextContent("TypeError");
  });

  it("restores inputs when a user returns from the results page", () => {
    sessionValue.mockImplementation((key: string) => (
      key === "rainassess-inputs"
        ? JSON.stringify({
            location: "Mumbai",
            roofAreaM2: 85.5,
            roofMaterial: "TILES",
            soilType: "LOAM",
            groundwaterDepthM: 6,
            availableGroundAreaM2: 5,
          })
        : null
    ));

    render(<AssessmentPage />);

    expect(screen.getByLabelText(/Location \/ Locality/)).toHaveValue("Mumbai");
    expect(screen.getByLabelText(/Roof Area/)).toHaveValue(85.5);
    expect(screen.getByLabelText(/Roof Material/)).toHaveValue("TILES");
    expect(screen.getByLabelText(/Soil Type/)).toHaveValue("LOAM");
  });
});
describe("roof area from dimensions", () => {
  it("computes area from decimal length and width", () => {
    render(<AssessmentPage />);

    fireEvent.click(screen.getByLabelText(/Calculate from length/));
    fireEvent.change(screen.getByLabelText(/Roof length/i), { target: { value: "10.5" } });
    fireEvent.change(screen.getByLabelText(/Roof width/i), { target: { value: "6.2" } });

    expect(screen.getByLabelText(/Roof Area/)).toHaveValue(65.1);
    expect(screen.getByText("10.5 m × 6.2 m = 65.1 m²")).toBeInTheDocument();
  });

  it("produces no area for zero, negative, or incomplete dimensions", () => {
    render(<AssessmentPage />);
    fireEvent.click(screen.getByLabelText(/Calculate from length/));

    fireEvent.change(screen.getByLabelText(/Roof length/i), { target: { value: "-3" } });
    fireEvent.change(screen.getByLabelText(/Roof width/i), { target: { value: "4" } });
    expect(screen.getByLabelText(/Roof Area/)).toHaveValue(null);

    fireEvent.change(screen.getByLabelText(/Roof length/i), { target: { value: "5" } });
    fireEvent.change(screen.getByLabelText(/Roof width/i), { target: { value: "0" } });
    expect(screen.getByLabelText(/Roof Area/)).toHaveValue(null);

    fireEvent.change(screen.getByLabelText(/Roof width/i), { target: { value: "" } });
    expect(screen.getByLabelText(/Roof Area/)).toHaveValue(null);
  });

  it("lets the user correct the computed area before submitting", () => {
    render(<AssessmentPage />);
    fireEvent.click(screen.getByLabelText(/Calculate from length/));
    fireEvent.change(screen.getByLabelText(/Roof length/i), { target: { value: "10" } });
    fireEvent.change(screen.getByLabelText(/Roof width/i), { target: { value: "5" } });

    const areaField = screen.getByLabelText(/Roof Area/);
    fireEvent.change(areaField, { target: { value: "49" } });
    expect(areaField).toHaveValue(49);
  });

  it("keeps the value when switching from dimensions back to direct entry", () => {
    render(<AssessmentPage />);
    fireEvent.click(screen.getByLabelText(/Calculate from length/));
    fireEvent.change(screen.getByLabelText(/Roof length/i), { target: { value: "10" } });
    fireEvent.change(screen.getByLabelText(/Roof width/i), { target: { value: "5" } });

    fireEvent.click(screen.getByLabelText(/Enter area directly/));
    expect(screen.getByLabelText(/Roof Area/)).toHaveValue(50);
    expect(screen.queryByLabelText(/Roof length/i)).not.toBeInTheDocument();
  });

  it("submits only roofAreaM2, never length or width, when using dimensions mode", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => successfulResult,
    }));
    render(<AssessmentPage />);

    fireEvent.change(screen.getByLabelText(/Location \/ Locality/), { target: { value: "Bengaluru" } });
    fireEvent.click(screen.getByLabelText(/Calculate from length/));
    fireEvent.change(screen.getByLabelText(/Roof length/i), { target: { value: "10" } });
    fireEvent.change(screen.getByLabelText(/Roof width/i), { target: { value: "5" } });
    fireEvent.change(screen.getByLabelText(/Roof Material/), { target: { value: "RCC" } });
    fireEvent.change(screen.getByLabelText(/Soil Type/), { target: { value: "SANDY_LOAM" } });
    fireEvent.change(screen.getByLabelText(/Groundwater Depth/), { target: { value: "8" } });
    fireEvent.change(screen.getByLabelText(/Available Ground Area/), { target: { value: "15" } });

    fireEvent.click(screen.getByRole("button", { name: /Calculate Assessment/ }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/result"));

    const request = vi.mocked(fetch).mock.calls[0][1] as RequestInit;
    const body = JSON.parse(request.body as string);
    expect(body.roofAreaM2).toBe(50);
    expect(body).not.toHaveProperty("roofLength");
    expect(body).not.toHaveProperty("width");
  });
});