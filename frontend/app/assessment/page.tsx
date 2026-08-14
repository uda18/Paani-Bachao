"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { AssessmentInput } from "@/lib/types";
import { FormField } from "@/components/FormField";
import { InfoNotice } from "@/components/InfoNotice";
import { SERVER_SNAPSHOT, useSessionValue } from "@/lib/session";
import { calculateRoofArea, roundForDisplay } from "@/lib/roofArea";
const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

function apiErrorMessage(body: unknown): string {
  if (!body || typeof body !== "object" || !("detail" in body)) {
    return "We could not complete the assessment. Please review the information and try again.";
  }
  const detail = (body as { detail?: unknown }).detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail) && detail[0] && typeof detail[0] === "object" && "msg" in detail[0]) {
    return String(detail[0].msg).replace(/^Value error, /, "");
  }
  return "We could not complete the assessment. Please review the information and try again.";
}

export default function AssessmentPage() {
  const router = useRouter();
  
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const storedInputs = useSessionValue("rainassess-inputs");
  const storedResult = useSessionValue("rainassess-result");

  let savedInputsForInit: AssessmentInput | null = null;
  if (storedInputs !== SERVER_SNAPSHOT && storedResult !== SERVER_SNAPSHOT) {
    try {
      savedInputsForInit = storedInputs
        ? JSON.parse(storedInputs)
        : storedResult
          ? JSON.parse(storedResult).inputs
          : null;
    } catch {
      savedInputsForInit = null;
    }
  }

  const [roofAreaMode, setRoofAreaMode] = useState<"direct" | "dimensions">("direct");
  const [roofLength, setRoofLength] = useState("");
  const [roofWidth, setRoofWidth] = useState("");
  const [roofAreaValue, setRoofAreaValue] = useState(
    savedInputsForInit?.roofAreaM2 ? String(savedInputsForInit.roofAreaM2) : "",
  );

  const computedArea = useMemo(() => {
    if (roofLength.trim() === "" || roofWidth.trim() === "") return null;
    return calculateRoofArea(Number(roofLength), Number(roofWidth));
  }, [roofLength, roofWidth]);

  function applyDimension(nextLength: string, nextWidth: string) {
    const area =
      nextLength.trim() === "" || nextWidth.trim() === ""
        ? null
        : calculateRoofArea(Number(nextLength), Number(nextWidth));
    setRoofAreaValue(area !== null ? String(roundForDisplay(area)) : "");
  }

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }, []);

  
  const savedInputs = savedInputsForInit;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const monthlyDemand = String(form.get("monthlyRainwaterDemandLitres") ?? "").trim();
    const basement = String(form.get("buildingHasBasement") ?? "").trim();
    const waterQualityEvidence = String(form.get("waterQualityEvidence") ?? "").trim();
    const payload = {
      location: form.get("location"),
      roofAreaM2: Number(form.get("roofAreaM2")),
      roofMaterial: form.get("roofMaterial"),
      soilType: form.get("soilType"),
      groundwaterDepthM: Number(form.get("groundwaterDepthM")),
      availableGroundAreaM2: Number(form.get("availableGroundAreaM2")),
      monthlyRainwaterDemandLitres: monthlyDemand ? Number(monthlyDemand) : undefined,
      buildingHasBasement: basement ? basement === "true" : undefined,
      waterQualityStatus: form.get("waterQualityStatus") || "NOT_VERIFIED",
      waterQualityEvidence: waterQualityEvidence || undefined,
    };

    try {
      const response = await fetch(`${apiUrl}/api/assessment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        throw new Error(apiErrorMessage(await response.json().catch(() => null)));
      }
      const result = await response.json();
      sessionStorage.setItem("rainassess-inputs", JSON.stringify(payload));
      sessionStorage.setItem("rainassess-result", JSON.stringify(result));
      router.push("/result");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "We could not complete the assessment. Please try again.");
      setSubmitting(false);
    }
  }

  if (storedInputs === SERVER_SNAPSHOT || storedResult === SERVER_SNAPSHOT) {
    return <main className="page-main"><div className="shell loading-state" role="status">Loading your property information…</div></main>;
  }

  return (
    <main className="page-main">
      <div className="page-title-band">
        <div className="shell">
          <span className="breadcrumb">Home <b aria-hidden="true">/</b> Assessment</span>
          <h1>Property Assessment</h1>
          <p>Provide basic information about your property to estimate rooftop rainwater harvesting and artificial recharge potential.</p>
        </div>
      </div>

      <div className="shell page-content assessment-layout">
        <form className="service-form" onSubmit={submit}>
          <div className="form-card">
            <header className="form-section-heading">
              <span>1</span>
              <div><h2>Property and rooftop details</h2><p>Information used to estimate available rooftop runoff.</p></div>
            </header>
            <div className="form-grid">
              <FormField id="location" label="Location / Locality" helper="Resolved to coordinates, then matched against the installed official rainfall dataset." className="field-wide">
                <input id="location" name="location" type="text" required maxLength={120} defaultValue={savedInputs?.location ?? ""} placeholder="Enter city, district or locality" aria-describedby="location-help" />
              </FormField>
              <FormField id="roofAreaM2" label="Roof Area" helper="Enter the approximate rooftop catchment area, or calculate it from dimensions." className="field-wide">
                <div className="roof-area-mode-toggle" role="radiogroup" aria-label="Roof area input method">
                  <label>
                    <input type="radio" name="roofAreaMode" checked={roofAreaMode === "direct"} onChange={() => setRoofAreaMode("direct")} />
                    Enter area directly
                  </label>
                  <label>
                    <input type="radio" name="roofAreaMode" checked={roofAreaMode === "dimensions"} onChange={() => { setRoofAreaMode("dimensions"); applyDimension(roofLength, roofWidth); }} />
                    Calculate from length × width
                  </label>
                </div>

                {roofAreaMode === "dimensions" && (
                  <div className="roof-dimensions-inputs">
                    <div className="control-with-unit">
                      <input type="number" min="0.01" step="0.01" value={roofLength} onChange={(e) => { setRoofLength(e.target.value); applyDimension(e.target.value, roofWidth); }} placeholder="Length" aria-label="Roof length in metres" />
                      <span>m</span>
                    </div>
                    <span aria-hidden="true">×</span>
                    <div className="control-with-unit">
                      <input type="number" min="0.01" step="0.01" value={roofWidth} onChange={(e) => { setRoofWidth(e.target.value); applyDimension(roofLength, e.target.value); }} placeholder="Width" aria-label="Roof width in metres" />
                      <span>m</span>
                    </div>
                    {computedArea !== null ? (
                      <p className="roof-area-formula">{roofLength} m × {roofWidth} m = {roundForDisplay(computedArea)} m²</p>
                    ) : (roofLength || roofWidth) ? (
                      <p className="roof-area-formula roof-area-formula-invalid">Enter positive length and width to calculate area.</p>
                    ) : null}
                  </div>
                )}

                <div className="control-with-unit">
                  <input
                    id="roofAreaM2"
                    name="roofAreaM2"
                    type="number"
                    min="0.1"
                    max="100000"
                    step="0.1"
                    required
                    value={roofAreaValue}
                    onChange={(e) => setRoofAreaValue(e.target.value)}
                    readOnly={roofAreaMode === "dimensions" && computedArea === null}
                    placeholder="Enter roof area in square metres"
                    aria-describedby="roofAreaM2-help"
                  />
                  <span>m²</span>
                </div>
              </FormField>
              <FormField id="roofMaterial" label="Roof Material" helper="Used to look up the configured runoff coefficient.">
                <select id="roofMaterial" name="roofMaterial" required defaultValue={savedInputs?.roofMaterial ?? ""} aria-describedby="roofMaterial-help">
                  <option value="" disabled>Select roof material</option><option value="RCC">RCC / Concrete</option><option value="TILES">Tiles</option><option value="METAL">GI sheet (galvanized iron)</option><option value="OTHER">Other</option><option value="DONT_KNOW">Don&apos;t know</option>
                </select>
              </FormField>
              <FormField id="monthlyRainwaterDemandLitres" label="Planned Monthly Rainwater Use" helper="Optional. Enter how many litres you plan to draw from the tank each month; required for tank sizing." className="field-wide">
                <div className="control-with-unit"><input id="monthlyRainwaterDemandLitres" name="monthlyRainwaterDemandLitres" type="number" min="0.1" max="10000000" step="0.1" defaultValue={savedInputs?.monthlyRainwaterDemandLitres ?? ""} placeholder="Enter planned rainwater use per month" aria-describedby="monthlyRainwaterDemandLitres-help" /><span>litres/month</span></div>
              </FormField>
            </div>
          </div>

          <div className="form-card">
            <header className="form-section-heading">
              <span>2</span>
              <div><h2>Ground and recharge details</h2><p>Basic site conditions used for the preliminary recharge assessment.</p></div>
            </header>
            <div className="form-grid form-grid-three">
              <FormField id="soilType" label="Soil Type" helper="Select “Don't know” if you are unsure.">
                <select id="soilType" name="soilType" required defaultValue={savedInputs?.soilType ?? ""} aria-describedby="soilType-help">
                  <option value="" disabled>Select soil type</option><option value="SANDY">Sandy</option><option value="SANDY_LOAM">Sandy Loam</option><option value="LOAM">Loam</option><option value="CLAYEY">Clayey</option><option value="ROCKY">Rocky</option><option value="DONT_KNOW">Don&apos;t know</option>
                </select>
              </FormField>
              <FormField id="groundwaterDepthM" label="Groundwater Depth" helper="Approximate depth from ground surface to groundwater level.">
                <div className="control-with-unit"><input id="groundwaterDepthM" name="groundwaterDepthM" type="number" min="0" max="1000" step="0.1" required defaultValue={savedInputs?.groundwaterDepthM ?? ""} placeholder="Enter depth in metres below ground level" aria-describedby="groundwaterDepthM-help" /><span>metres</span></div>
              </FormField>
              <FormField id="availableGroundAreaM2" label="Available Ground Area" helper="Open area that could accommodate a recharge structure.">
                <div className="control-with-unit"><input id="availableGroundAreaM2" name="availableGroundAreaM2" type="number" min="0" max="100000" step="0.1" required defaultValue={savedInputs?.availableGroundAreaM2 ?? ""} placeholder="Enter available open area in square metres" aria-describedby="availableGroundAreaM2-help" /><span>m²</span></div>
              </FormField>
              <FormField id="buildingHasBasement" label="Building Basement" helper="Some source-backed recharge designs do not apply to buildings with basements.">
                <select id="buildingHasBasement" name="buildingHasBasement" defaultValue={savedInputs?.buildingHasBasement === undefined ? "" : String(savedInputs.buildingHasBasement)} aria-describedby="buildingHasBasement-help">
                  <option value="">Select if known</option><option value="false">No basement</option><option value="true">Has a basement</option>
                </select>
              </FormField>
              <FormField id="waterQualityStatus" label="Recharge Water Quality Review" helper="Do not mark acceptable unless a qualified test or review supports it.">
                <select id="waterQualityStatus" name="waterQualityStatus" defaultValue={savedInputs?.waterQualityStatus ?? "NOT_VERIFIED"} aria-describedby="waterQualityStatus-help">
                  <option value="NOT_VERIFIED">Not yet verified</option><option value="VERIFIED_ACCEPTABLE">Reviewed as acceptable</option><option value="UNSUITABLE">Review found unsuitable</option>
                </select>
              </FormField>
              <FormField id="waterQualityEvidence" label="Water Quality Evidence" helper="Required only when recording a reviewed conclusion; enter the report, reviewer or source reference.">
                <input id="waterQualityEvidence" name="waterQualityEvidence" type="text" maxLength={300} defaultValue={savedInputs?.waterQualityEvidence ?? ""} placeholder="Enter report or review reference if applicable" aria-describedby="waterQualityEvidence-help" />
              </FormField>
            </div>
          </div>

          {error && <InfoNotice title="Assessment could not be completed" tone="error" className="form-message"><p>{error}</p></InfoNotice>}

          <div className="form-actionbar">
            <p>Fields marked <span aria-hidden="true">*</span> are required. Your results are preliminary.</p>
            <button className="button button-primary submit-button" type="submit" disabled={submitting} aria-live="polite">
              {submitting ? <><span className="loading-dot" aria-hidden="true" /> Calculating assessment…</> : <>Calculate Assessment <span aria-hidden="true">→</span></>}
            </button>
          </div>
        </form>

        <aside className="assessment-sidebar" aria-label="Assessment guidance">
          <h2>Before you begin</h2>
          <ul>
            <li>Use the horizontal catchment area of your roof.</li>
            <li>User estimates are identified as user-provided and are not presented as measured data.</li>
            <li>Monthly planned rainwater use is optional, but a tank size cannot be calculated without it.</li>
          </ul>
          <InfoNotice title="Data use">
            <p>Your entries are used only to calculate the current assessment and are retained in this browser session.</p>
          </InfoNotice>
        </aside>
      </div>
    </main>
  );
}
