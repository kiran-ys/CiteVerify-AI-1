import {
  type DragEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  ExtractCitationsResponse,
  ExtractEvidenceResponse,
  VerificationStatusResponse,
  VerifyClaimsResponse,
} from "@citeverify/shared";
import {
  extractPdfCitations,
  extractPdfEvidence,
  extractPdfVerification,
  getVerificationStatus,
} from "./api.ts";
import { ExtractedClaims } from "./ExtractedClaims.tsx";

type Page = "dashboard" | "upload" | "results" | "reports";
type Status =
  | "Supported"
  | "Partially supported"
  | "Unsupported"
  | "Contradictory"
  | "Unable to verify";
type Claim = {
  id: string;
  text: string;
  citation: string;
  status: Status;
  score?: number;
  evidence: string;
  explanation: string;
};

const claims: Claim[] = [
  {
    id: "CLM-024",
    text: "The intervention was associated with a measurable reduction in the primary outcome after 12 weeks.",
    citation: "Martinez et al. (2023), p. 8",
    status: "Supported",
    score: 94,
    evidence:
      "The illustrative source reports a statistically significant change in the primary outcome at the 12-week assessment.",
    explanation:
      "The study population, duration, and direction of the outcome align with the claim.",
  },
  {
    id: "CLM-023",
    text: "Earlier work established that the observed effect persists across all age groups.",
    citation: "Chen & Rao (2021), Table 2",
    status: "Partially supported",
    score: 71,
    evidence:
      "The illustrative source discusses subgroup results but does not evaluate every age group referenced.",
    explanation:
      "The citation supports sampled subgroups only. The phrase ‘all age groups’ extends beyond the evidence.",
  },
  {
    id: "CLM-022",
    text: "This method is currently the most widely adopted approach in clinical settings.",
    citation: "Okafor et al. (2020), p. 3",
    status: "Unsupported",
    score: 89,
    evidence:
      "The illustrative paper describes the method but provides no adoption or prevalence data.",
    explanation:
      "A broad adoption statement requires usage data or a systematic survey, which is absent here.",
  },
  {
    id: "CLM-021",
    text: "The treatment group experienced fewer adverse events than the control group.",
    citation: "Singh et al. (2022), p. 11",
    status: "Contradictory",
    score: 92,
    evidence:
      "The illustrative results report a higher observed adverse-event count in the treatment group.",
    explanation:
      "The direction of the manuscript’s comparison conflicts with the cited passage and needs human review.",
  },
  {
    id: "CLM-020",
    text: "No comparable study has been published in the past decade.",
    citation: "No citation detected",
    status: "Unable to verify",
    evidence:
      "No citation was linked and this demo does not perform a live literature search.",
    explanation:
      "Novelty claims require a reproducible literature search and cannot be verified from the manuscript alone.",
  },
];

const statusClass: Record<Status, string> = {
  Supported: "supported",
  "Partially supported": "partial",
  Unsupported: "unsupported",
  Contradictory: "contradictory",
  "Unable to verify": "unable",
};
const nav: { id: Page; label: string; icon: string }[] = [
  { id: "dashboard", label: "Dashboard", icon: "grid" },
  { id: "upload", label: "Upload Paper", icon: "upload" },
  { id: "results", label: "Verification Results", icon: "check" },
  { id: "reports", label: "Reports", icon: "file" },
];
const headings: Record<Page, [string, string]> = {
  dashboard: [
    "Good morning, Dr. Morgan",
    "Here’s an overview of your citation verification workspace.",
  ],
  upload: [
    "Upload a research paper",
    "Add a PDF to extract and review its actual text.",
  ],
  results: [
    "Verification results",
    "Review extracted claims, citations, and matched evidence.",
  ],
  reports: [
    "Reports",
    "Prepare transparent verification summaries for review and export.",
  ],
};

export function App() {
  const [page, setPage] = useState<Page>("dashboard");
  const [menu, setMenu] = useState(false);
  const [detail, setDetail] = useState<Claim>();
  const go = (p: Page) => {
    setPage(p);
    setMenu(false);
    setDetail(undefined);
  };
  return (
    <div className="app">
      <a href="#main" className="skip">
        Skip to content
      </a>
      <aside className={`sidebar ${menu ? "open" : ""}`}>
        <div className="brand">
          <span>
            <Icon name="verify" />
          </span>
          <strong>
            CiteVerify <em>AI</em>
          </strong>
        </div>
        <small className="nav-label">WORKSPACE</small>
        <nav aria-label="Primary navigation">
          {nav.map((n) => (
            <button
              key={n.id}
              className={page === n.id ? "active" : ""}
              onClick={() => go(n.id)}
              type="button"
            >
              <Icon name={n.icon} />
              {n.label}
              {n.id === "results" && <i>24</i>}
            </button>
          ))}
        </nav>
        <div className="spacer" />
        <div className="demo-note">
          <Icon name="sparkle" />
          <div>
            <b>Demo workspace</b>
            <p>All content is illustrative, not real scientific evidence.</p>
          </div>
        </div>
        <button className="profile" type="button">
          <span>AM</span>
          <div>
            <b>Alex Morgan</b>
            <small>Research team</small>
          </div>
          <Icon name="more" />
        </button>
      </aside>
      {menu && (
        <button
          className="scrim"
          aria-label="Close navigation"
          type="button"
          onClick={() => setMenu(false)}
        />
      )}
      <div className="main-col">
        <header>
          <button
            className="menu"
            type="button"
            aria-label="Open navigation"
            onClick={() => setMenu(true)}
          >
            <Icon name="menu" />
          </button>
          <div>
            <span className="demo-pill">
              <i />
              DEMO DATA
            </span>
            <button
              className="icon-btn"
              type="button"
              aria-label="Notifications"
            >
              <Icon name="bell" />
            </button>
            <span className="avatar">AM</span>
          </div>
        </header>
        <main id="main">
          <div className="page-head">
            <div>
              <h1>{headings[page][0]}</h1>
              <p>{headings[page][1]}</p>
            </div>
            {page === "dashboard" && (
              <Button onClick={() => go("upload")}>
                <Icon name="plus" />
                Upload paper
              </Button>
            )}
          </div>
          {page === "dashboard" && <Dashboard go={go} detail={setDetail} />}
          {page === "upload" && <Upload />}
          {page === "results" && <Results detail={setDetail} />}
          {page === "reports" && <Reports go={go} />}
        </main>
      </div>
      {detail && <Evidence claim={detail} close={() => setDetail(undefined)} />}
    </div>
  );
}

function Dashboard({
  go,
  detail,
}: {
  go: (p: Page) => void;
  detail: (c: Claim) => void;
}) {
  const stats = [
    ["file", "Uploaded papers", "12", "+2 this month", "blue"],
    ["scan", "Claims analysed", "348", "+86 this month", "violet"],
    ["shield", "Supported claims", "241", "69.3% of total", "green"],
    ["alert", "Require review", "37", "10.6% of total", "amber"],
  ] as const;
  return (
    <>
      <section className="stats" aria-label="Workspace summary">
        {stats.map((s) => (
          <article key={s[1]}>
            <span className={`stat-icon ${s[4]}`}>
              <Icon name={s[0]} />
            </span>
            <small>{s[1]}</small>
            <strong>{s[2]}</strong>
            <p>{s[3]}</p>
          </article>
        ))}
      </section>
      <div className="dashboard-grid">
        <section className="panel">
          <PanelHead
            title="Recent document activity"
            sub="Latest papers added to this workspace"
            action={() => go("results")}
          />
          <div className="activity">
            <Activity
              title="Effects of Early Intervention on Long-term Outcomes"
              meta="Uploaded 18 min ago · 32 claims"
              status="Review needed"
              tone="review"
            />
            <Activity
              title="A Systematic Review of Neural Biomarkers"
              meta="Verified yesterday · 47 claims"
              status="Completed"
              tone="complete"
            />
            <Activity
              title="Environmental Exposure and Population Health"
              meta="Uploaded Nov 16 · 28 claims"
              status="Completed"
              tone="complete"
            />
            <Activity
              title="Novel Approaches to Drug Delivery Systems"
              meta="Uploaded Nov 14 · Processing claims"
              status="Analysing"
              tone="analysing"
            />
          </div>
        </section>
        <section className="panel distribution">
          <PanelHead
            title="Claim distribution"
            sub="Across all analysed papers"
          />
          <div className="chart-wrap">
            <div className="donut">
              <span>
                <b>69%</b>supported
              </span>
            </div>
            <div className="legend">
              {[
                ["Supported", "241", "green"],
                ["Partially supported", "43", "blue"],
                ["Unsupported", "18", "amber"],
                ["Contradictory", "9", "red"],
                ["Unable to verify", "37", "gray"],
              ].map((x) => (
                <p key={x[0]}>
                  <i className={x[2]} />
                  {x[0]}
                  <b>{x[1]}</b>
                </p>
              ))}
            </div>
          </div>
          <button
            className="secondary wide"
            onClick={() => go("results")}
            type="button"
          >
            Explore all claims
          </button>
        </section>
      </div>
      <section className="panel attention">
        <PanelHead
          title="Claims requiring attention"
          sub="High-priority items for human review"
          action={() => go("results")}
        />
        {claims.slice(1, 4).map((c) => (
          <button type="button" key={c.id} onClick={() => detail(c)}>
            <i className={`dot ${statusClass[c.status]}`} />
            <span>
              <b>{c.text}</b>
              <small>{c.citation}</small>
            </span>
            <Badge status={c.status} />
            <Icon name="right" />
          </button>
        ))}
      </section>
    </>
  );
}

function PanelHead({
  title,
  sub,
  action,
}: {
  title: string;
  sub: string;
  action?: () => void;
}) {
  return (
    <div className="panel-head">
      <div>
        <h2>{title}</h2>
        <p>{sub}</p>
      </div>
      {action && (
        <button type="button" onClick={action}>
          View all
        </button>
      )}
    </div>
  );
}
function Activity({
  title,
  meta,
  status,
  tone,
}: {
  title: string;
  meta: string;
  status: string;
  tone: string;
}) {
  return (
    <div className="activity-row">
      <span className="pdf">
        <Icon name="file" />
        <b>PDF</b>
      </span>
      <div>
        <b>{title}</b>
        <small>{meta}</small>
        {tone === "analysing" && (
          <span className="progress">
            <i />
          </span>
        )}
      </div>
      <em className={tone}>
        <i />
        {status}
      </em>
      <Icon name="right" />
    </div>
  );
}

function Upload() {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File>();
  const [error, setError] = useState("");
  const [phase, setPhase] = useState<"idle" | "extracting" | "success">("idle");
  const [result, setResult] = useState<
    ExtractCitationsResponse | ExtractEvidenceResponse | VerifyClaimsResponse
  >();
  const [drag, setDrag] = useState(false);
  const [retrieving, setRetrieving] = useState(false);
  const [retrieveError, setRetrieveError] = useState("");
  // Each new file or extraction bumps this, so late responses for an older file are ignored.
  const generation = useRef(0);
  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState("");
  const [modelStatus, setModelStatus] = useState<VerificationStatusResponse>();
  const reset = () => {
    generation.current++;
    setResult(undefined);
    setRetrieving(false);
    setRetrieveError("");
    setVerifying(false);
    setVerifyError("");
  };
  // Report model availability before upload so a public demo never implies
  // that AI verification is ready when the free host cannot run Ollama.
  useEffect(() => {
    getVerificationStatus().then(setModelStatus);
  }, []);
  const accept = (f?: File) => {
    setError("");
    reset();
    setPhase("idle");
    if (!f) return;
    if (
      !f.name.toLowerCase().endsWith(".pdf") ||
      (f.type && f.type !== "application/pdf")
    )
      return setError("Please choose a PDF file.");
    if (f.size > 25 * 1024 * 1024)
      return setError("This file exceeds the 25 MB limit.");
    setFile(f);
  };
  const drop = (e: DragEvent) => {
    e.preventDefault();
    setDrag(false);
    accept(e.dataTransfer.files[0]);
  };
  const remove = () => {
    setFile(undefined);
    reset();
    setError("");
    setPhase("idle");
    if (input.current) input.current.value = "";
  };
  const upload = async () => {
    if (!file) return;
    setError("");
    reset();
    const current = generation.current;
    setPhase("extracting");
    try {
      const extracted = await extractPdfCitations(file);
      if (current !== generation.current) return;
      setResult(extracted);
      setPhase("success");
    } catch (cause) {
      if (current !== generation.current) return;
      setPhase("idle");
      setError(
        cause instanceof Error ? cause.message : "PDF extraction failed.",
      );
    }
  };
  const retrieveSources = async () => {
    if (!file) return;
    const current = generation.current;
    setRetrieving(true);
    setRetrieveError("");
    try {
      const withEvidence = await extractPdfEvidence(file);
      if (current === generation.current) setResult(withEvidence);
    } catch (cause) {
      if (current === generation.current) {
        setRetrieveError(
          cause instanceof Error ? cause.message : "Source retrieval failed.",
        );
      }
    } finally {
      if (current === generation.current) setRetrieving(false);
    }
  };
  const verifyClaims = async () => {
    if (!file) return;
    const current = generation.current;
    setVerifying(true);
    setVerifyError("");
    try {
      const verified = await extractPdfVerification(file);
      if (current === generation.current) setResult(verified);
    } catch (cause) {
      if (current === generation.current) {
        setVerifyError(
          cause instanceof Error ? cause.message : "Claim verification failed.",
        );
      }
    } finally {
      if (current === generation.current) {
        setVerifying(false);
        getVerificationStatus().then(setModelStatus);
      }
    }
  };
  return (
    <div className="upload-grid">
      <section className="panel upload-panel">
        <section
          className={`dropzone ${drag ? "drag" : ""}`}
          aria-label="PDF upload drop zone"
          onDragOver={(e) => e.preventDefault()}
          onDragEnter={() => setDrag(true)}
          onDragLeave={() => setDrag(false)}
          onDrop={drop}
        >
          <input
            ref={input}
            type="file"
            accept=".pdf,application/pdf"
            onChange={(e) => accept(e.target.files?.[0])}
          />
          <span>
            <Icon name="cloud" />
          </span>
          <h2>Drop your research paper here</h2>
          <p>or select a file from your computer</p>
          <button
            className="secondary"
            type="button"
            onClick={() => input.current?.click()}
          >
            Choose PDF file
          </button>
          <small>PDF only · Maximum file size 25 MB</small>
        </section>
        {error && (
          <div className="error" role="alert">
            <Icon name="alert" />
            {error}
          </div>
        )}
        {file && (
          <div className="selected">
            <span className="pdf">
              <Icon name="file" />
              <b>PDF</b>
            </span>
            <div>
              <b>{file.name}</b>
              <small>{(file.size / 1048576).toFixed(1)} MB</small>
            </div>
            {phase === "success" ? (
              <em>
                <Icon name="check" />
                Text extracted
              </em>
            ) : (
              <button type="button" onClick={remove} aria-label="Remove file">
                <Icon name="close" />
              </button>
            )}
          </div>
        )}
        <div className="upload-actions">
          <Button disabled={!file || phase === "extracting"} onClick={upload}>
            {phase === "extracting"
              ? "Extracting text, claims and citations…"
              : phase === "success"
                ? "Extract again"
                : "Extract text, claims and citations"}
          </Button>
        </div>
        <div className="info">
          <Icon name="info" />
          <p>
            <b>Live extraction.</b> The PDF is sent to the local Hono API and
            parsed in memory. It is not saved. Candidate claims and their
            citations are found by transparent rules; a matched citation only
            links a claim to the paper's own reference list and is not evidence.
            Verification results elsewhere in the app remain demo-only.
          </p>
        </div>
        {modelStatus && !modelStatus.available && (
          <div className="error" role="status">
            <Icon name="alert" />
            <span>
              <b>AI verification is temporarily unavailable on this free server.</b>{" "}
              PDF extraction, claim extraction, citation matching, and source
              retrieval are still available. No AI verdict will be guessed.
            </span>
          </div>
        )}
        {result && (
          <section className="extraction-result" aria-live="polite">
            <header>
              <div>
                <small>ACTUAL PDF OUTPUT</small>
                <h2>{result.document.name}</h2>
              </div>
              <span>
                <Icon name="check" />
                Extraction complete
              </span>
            </header>
            <div className="extraction-meta">
              <p>
                <small>Pages</small>
                <b>{result.document.pageCount}</b>
              </p>
              <p>
                <small>Characters</small>
                <b>{result.extraction.text.length.toLocaleString()}</b>
              </p>
              <p>
                <small>Parser</small>
                <b>
                  {result.extraction.parser.name}{" "}
                  {result.extraction.parser.version}
                </b>
              </p>
            </div>
            {result.extraction.warnings.length > 0 && (
              <div className="extraction-warnings">
                {result.extraction.warnings.map((warning) => (
                  <p key={`${warning.code}-${warning.page}`}>
                    <Icon name="alert" />
                    {warning.message}
                  </p>
                ))}
              </div>
            )}
            <div className="extracted-text">
              <small>EXTRACTED TEXT</small>
              <pre>{result.extraction.text}</pre>
            </div>
          </section>
        )}
        {result && (
          <ExtractedClaims
            claims={result.claims}
            citations={result.citations}
            consistency={result.internalConsistency}
            retrieval={{
              evidence: "evidence" in result ? result.evidence : undefined,
              retrieving,
              error: retrieveError,
              onRetrieve: retrieveSources,
            }}
            verification={{
              status: modelStatus,
              result:
                "verification" in result ? result.verification : undefined,
              verifying,
              error: verifyError,
              onVerify: verifyClaims,
            }}
          />
        )}
      </section>
      <aside>
        <section className="panel process">
          <h2>What happens now?</h2>
          <Step n="1" icon="upload" title="Upload safely">
            Validate one PDF up to 25 MB.
          </Step>
          <Step n="2" icon="scan" title="Extract actual text">
            Parse the document and preserve page-level output.
          </Step>
          <Step n="3" icon="file" title="Review the result">
            Read the extracted text and candidate claims. Verification comes
            later.
          </Step>
        </section>
        <div className="privacy">
          <Icon name="lock" />
          <div>
            <b>No document persistence</b>
            <p>
              This milestone processes the PDF in memory and does not save the
              upload or extracted text.
            </p>
          </div>
        </div>
      </aside>
    </div>
  );
}
function Step({
  n,
  icon,
  title,
  children,
}: {
  n: string;
  icon: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="step">
      <span>
        <Icon name={icon} />
        <i>{n}</i>
      </span>
      <div>
        <b>{title}</b>
        <p>{children}</p>
      </div>
    </div>
  );
}

function Results({ detail }: { detail: (c: Claim) => void }) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Status | "All statuses">("All statuses");
  const shown = useMemo(
    () =>
      claims.filter(
        (c) =>
          (filter === "All statuses" || c.status === filter) &&
          `${c.text} ${c.citation}`.toLowerCase().includes(q.toLowerCase()),
      ),
    [q, filter],
  );
  return (
    <>
      <div className="summary">
        <div>
          <small>Document</small>
          <b>Effects of Early Intervention on Long-term Outcomes.pdf</b>
        </div>
        <div>
          <small>Claims</small>
          <b>32 detected</b>
        </div>
        <div>
          <small>Review status</small>
          <b>8 need review</b>
        </div>
        <button className="secondary" type="button">
          <Icon name="download" />
          Export report
        </button>
      </div>
      <section className="panel results">
        <div className="toolbar">
          <label>
            <Icon name="search" />
            <span className="sr">Search claims</span>
            <input
              placeholder="Search claims or citations…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </label>
          <label className="filter">
            <Icon name="filter" />
            <span className="sr">Filter status</span>
            <select
              value={filter}
              onChange={(e) =>
                setFilter(e.target.value as Status | "All statuses")
              }
            >
              <option>All statuses</option>
              {Object.keys(statusClass).map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
            <Icon name="down" />
          </label>
          <small>
            {shown.length} of {claims.length} claims
          </small>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Claim</th>
                <th>Citation reference</th>
                <th>Status</th>
                <th>Confidence</th>
                <th>
                  <span className="sr">Action</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((c) => (
                <tr key={c.id}>
                  <td>
                    <button
                      className="claim"
                      type="button"
                      onClick={() => detail(c)}
                    >
                      <small>{c.id}</small>
                      {c.text}
                    </button>
                  </td>
                  <td>
                    <span className="citation">
                      <Icon name="book" />
                      {c.citation}
                    </span>
                  </td>
                  <td>
                    <Badge status={c.status} />
                  </td>
                  <td>
                    {c.score ? (
                      <span className="confidence">
                        <i>
                          <b style={{ width: `${c.score}%` }} />
                        </i>
                        {c.score}%
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td>
                    <button
                      className="row-action"
                      type="button"
                      onClick={() => detail(c)}
                      aria-label={`View ${c.id}`}
                    >
                      <Icon name="right" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!shown.length && (
            <div className="empty">
              <Icon name="search" />
              <h3>No claims found</h3>
              <p>Try a different search or filter.</p>
            </div>
          )}
        </div>
      </section>
    </>
  );
}
function Badge({ status }: { status: Status }) {
  return (
    <span className={`badge ${statusClass[status]}`}>
      <i />
      {status}
    </span>
  );
}

function Evidence({ claim, close }: { claim: Claim; close: () => void }) {
  return (
    <div
      className="drawer-layer"
      role="dialog"
      aria-modal="true"
      aria-labelledby="drawer-title"
    >
      <button
        className="drawer-scrim"
        type="button"
        onClick={close}
        aria-label="Close evidence"
      />
      <aside className="drawer">
        <div className="drawer-head">
          <div>
            <small>Evidence comparison · {claim.id}</small>
            <h2 id="drawer-title">Review claim evidence</h2>
          </div>
          <button className="icon-btn" onClick={close} type="button">
            <Icon name="close" />
          </button>
        </div>
        <div className="drawer-body">
          <div className="demo-banner">
            <Icon name="info" />
            <p>
              <b>Demonstration content.</b> The claim, citation and evidence
              below are illustrative placeholders—not genuine scientific
              findings.
            </p>
          </div>
          <EvidenceBlock icon="quote" title="ORIGINAL SCIENTIFIC CLAIM">
            <blockquote>{claim.text}</blockquote>
          </EvidenceBlock>
          <EvidenceBlock icon="book" title="MATCHED CITATION">
            <div className="source">
              <div>
                <b>{claim.citation}</b>
                <small>Illustrative source record</small>
              </div>
              <button type="button">Source unavailable in demo</button>
            </div>
          </EvidenceBlock>
          <EvidenceBlock icon="highlight" title="EVIDENCE PASSAGE">
            <p className="passage">{claim.evidence}</p>
          </EvidenceBlock>
          <section className="explanation">
            <span>
              <Icon name="sparkle" />
              VERIFICATION EXPLANATION
            </span>
            <Badge status={claim.status} />
            <p>{claim.explanation}</p>
            <div>
              <small>Model confidence</small>
              <b>{claim.score ? `${claim.score}%` : "Not available"}</b>
            </div>
          </section>
          <div className="review">
            <div>
              <small>Review status</small>
              <b>Needs review</b>
            </div>
            <button className="secondary" type="button">
              <Icon name="check" />
              Mark as reviewed
            </button>
          </div>
        </div>
        <footer>
          <button className="secondary" type="button" onClick={close}>
            Close
          </button>
          <Button>
            <Icon name="flag" />
            Flag for review
          </Button>
        </footer>
      </aside>
    </div>
  );
}
function EvidenceBlock({
  icon,
  title,
  children,
}: {
  icon: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="evidence">
      <span>
        <Icon name={icon} />
        {title}
      </span>
      {children}
    </section>
  );
}

function Reports({ go }: { go: (p: Page) => void }) {
  return (
    <div className="reports-grid">
      <section className="panel report-builder">
        <span className="report-icon">
          <Icon name="report" />
        </span>
        <span className="demo-pill">
          <i />
          DEMO PREVIEW
        </span>
        <h2>Build a transparent verification report</h2>
        <p>
          Summarise claim classifications, evidence comparisons, confidence
          indicators, and human review notes in one exportable document.
        </p>
        <div>
          <span>
            <Icon name="check" />
            Claim-by-claim evidence
          </span>
          <span>
            <Icon name="check" />
            Review audit trail
          </span>
          <span>
            <Icon name="check" />
            Source references
          </span>
        </div>
        <Button onClick={() => go("results")}>Select claims for report</Button>
      </section>
      <section className="panel recent-reports">
        <PanelHead
          title="Recent reports"
          sub="Generated from demo workspace data"
        />
        <div className="empty">
          <Icon name="file" />
          <h3>No reports generated yet</h3>
          <p>Reports will appear here when export services are connected.</p>
        </div>
      </section>
    </div>
  );
}
function Button({
  children,
  onClick,
  disabled,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      className="primary"
      type="button"
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

function Icon({ name }: { name: string }) {
  const p: Record<string, ReactNode> = {
    grid: (
      <>
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
      </>
    ),
    upload: (
      <>
        <path d="M12 3v12m0-12 4 4m-4-4L8 7" />
        <path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" />
      </>
    ),
    check: (
      <>
        <path d="m8.5 12.5 2 2 5-5" />
        <circle cx="12" cy="12" r="9" />
      </>
    ),
    file: (
      <>
        <path d="M6 2.5h8l4 4V21H6z" />
        <path d="M14 2.5v4h4M9 12h6M9 16h5" />
      </>
    ),
    verify: (
      <>
        <path d="M12 2.5 20 6v5.5c0 5-3.3 8.2-8 10-4.7-1.8-8-5-8-10V6z" />
        <path d="m8.5 12 2 2 5-5" />
      </>
    ),
    sparkle: (
      <path d="m12 3 1.2 3.2L16 7.5l-2.8 1.3L12 12l-1.2-3.2L8 7.5l2.8-1.3zM18 14l.7 1.8 1.8.7-1.8.7L18 19l-.7-1.8-1.8-.7 1.8-.7z" />
    ),
    more: (
      <>
        <circle cx="12" cy="5" r="1" />
        <circle cx="12" cy="12" r="1" />
        <circle cx="12" cy="19" r="1" />
      </>
    ),
    menu: <path d="M4 7h16M4 12h16M4 17h16" />,
    bell: (
      <>
        <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
        <path d="M10 21h4" />
      </>
    ),
    plus: <path d="M12 5v14M5 12h14" />,
    scan: (
      <>
        <path d="M8 3H4v5M16 3h4v5M20 16v5h-4M8 21H4v-5" />
        <path d="M7 12h10M9 8h6M9 16h6" />
      </>
    ),
    shield: (
      <>
        <path d="M12 2.5 20 6v5.5c0 5-3.3 8.2-8 10-4.7-1.8-8-5-8-10V6z" />
        <path d="m8.5 12 2 2 5-5" />
      </>
    ),
    alert: (
      <>
        <path d="M10 4 2.5 19h19L14 4a2.2 2.2 0 0 0-4 0Z" />
        <path d="M12 9v4M12 17h.01" />
      </>
    ),
    right: <path d="m9 18 6-6-6-6" />,
    cloud: (
      <>
        <path d="M16 16l-4-4-4 4M12 12v9" />
        <path d="M20 18a5 5 0 0 0-2-9.6A7 7 0 0 0 4 10a4.5 4.5 0 0 0 1 9h2" />
      </>
    ),
    close: <path d="M6 6l12 12M18 6 6 18" />,
    info: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 11v6M12 7h.01" />
      </>
    ),
    link: (
      <>
        <path d="M10 13a5 5 0 0 0 7.5.5l2-2a5 5 0 0 0-7-7l-1 1" />
        <path d="M14 11a5 5 0 0 0-7.5-.5l-2 2a5 5 0 0 0 7 7l1-1" />
      </>
    ),
    lock: (
      <>
        <rect x="4" y="10" width="16" height="11" rx="2" />
        <path d="M8 10V7a4 4 0 0 1 8 0v3" />
      </>
    ),
    download: (
      <>
        <path d="M12 3v12m0 0 4-4m-4 4-4-4M5 20h14" />
      </>
    ),
    search: (
      <>
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-4-4" />
      </>
    ),
    filter: <path d="M4 5h16l-6 7v6l-4 2v-8z" />,
    down: <path d="m7 9 5 5 5-5" />,
    book: (
      <>
        <path d="M4 4h7a3 3 0 0 1 3 3v13a3 3 0 0 0-3-3H4z" />
        <path d="M20 4h-3a3 3 0 0 0-3 3v13a3 3 0 0 1 3-3h3z" />
      </>
    ),
    quote: <path d="M9 11H5a4 4 0 0 1 4-4v9H5M19 11h-4a4 4 0 0 1 4-4v9h-4" />,
    highlight: <path d="m15 4 5 5L9 20H4v-5zM13 6l5 5" />,
    flag: <path d="M5 21V4M5 5h11l-2 4 2 4H5" />,
    report: (
      <>
        <path d="M6 2.5h8l4 4V21H6zM14 2.5v4h4" />
        <path d="M9 16v-3M12 16V9M15 16v-5" />
      </>
    ),
  };
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {p[name]}
    </svg>
  );
}
