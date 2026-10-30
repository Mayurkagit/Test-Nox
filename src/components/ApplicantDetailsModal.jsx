import React, { useState, useEffect, useMemo } from "react";
import { useApplicantStore, useAutomationStore } from "../store";
import { detectDdaStage } from "../utils/ddaRoutes";
import CATEGORIES from "../data/categories.json";
import BANKS from "../data/banks.json";
import STATES from "../data/states.json";
import DISTRICTS_BY_STATE from "../data/districts.json";
import OFFLINE_STORE from "../../dda_db/dda_offline_store.json";
import PdfPages from "./PdfPages.jsx";

const LOCALITY_OPTIONS = [
  { value: "1", label: "NARELA" },
  { value: "2", label: "ROHINI" },
  { value: "3", label: "TODAPUR" },
  { value: "4", label: "LOKNAYAKPURAM" },
  { value: "5", label: "DWARKA" },
];

const STATUTORY_BODIES = [
  { value: "NMC", label: "National Medical Commission (NMC)" },
  { value: "BCI", label: "Bar Council of India (BCI)" },
  { value: "ICAI", label: "Institute of Chartered Accountants of India (ICAI)" },
  { value: "ICSI", label: "Institute of Company Secretaries of India (ICSI)" },
  { value: "CMA", label: "Institute of Cost Accountants of India (ICAI/CMA)" },
  { value: "COA", label: "Council of Architecture (CoA)" },
  { value: "NCTE", label: "National Council for Teacher Education (NCTE)" },
  { value: "DCI", label: "Dental Council of India (DCI)" },
  { value: "INC", label: "Indian Nursing Council (INC)" },
  { value: "other", label: "Other" },
];

const getBodyLabel = (code) => {
  const found = STATUTORY_BODIES.find((b) => b.value === code);
  return found ? found.label : code;
};

export default function ApplicantDetailsModal({
  isOpen: propIsOpen,
  applicant: propApplicant,
  onClose: propOnClose,
}) {
  const storeIsOpen = useApplicantStore((state) => state.isDetailsModalOpen);
  const storeViewingApplicant = useApplicantStore((state) => state.viewingApplicant);
  const storeActiveApplicant = useApplicantStore((state) => state.activeApplicant);
  const storeApplicants = useApplicantStore((state) => state.applicants);
  const storeMasterApplicants = useApplicantStore((state) => state.masterApplicants);
  const storeCloseModal = useApplicantStore((state) => state.closeDetailsModal);

  const isOpen = propIsOpen !== undefined ? propIsOpen : storeIsOpen;
  const rawApplicant = propApplicant || storeViewingApplicant || storeActiveApplicant;
  const onClose = propOnClose || storeCloseModal;

  const currentUrl = useAutomationStore((state) => state.currentUrl);
  const activeStage = detectDdaStage(currentUrl);
  const isSchemesStage = activeStage?.id === "SCHEME" || (currentUrl && currentUrl.toLowerCase().includes("schemelist"));

  // Strictly for the schemes page sidebar only: auto-close if navigating away from schemes page
  useEffect(() => {
    if (storeIsOpen && !isSchemesStage) {
      storeCloseModal();
    }
  }, [storeIsOpen, isSchemesStage, storeCloseModal]);

  const [activeTab, setActiveTab] = useState("personal");
  const [previewDoc, setPreviewDoc] = useState(null);

  // Close on Escape key (closes preview overlay first if open)
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === "Escape") {
        if (previewDoc) {
          setPreviewDoc(null);
        } else if (isOpen) {
          onClose();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose, previewDoc]);

  // Reset to personal tab and clear preview whenever modal opens
  useEffect(() => {
    if (isOpen) {
      setActiveTab("personal");
      setPreviewDoc(null);
    }
  }, [isOpen]);

  // Cross-reference and resolve the applicant from all memory and persistent storage
  const viewDetails = useMemo(() => {
    if (!rawApplicant) return null;

    const targetPan = (
      rawApplicant.pan ||
      rawApplicant.personal?.pan ||
      rawApplicant.id ||
      ""
    ).toUpperCase().trim();

    // 1. Check in-memory applicant stores
    const foundFromStore =
      (storeApplicants || []).find(
        (a) => (a.pan || a.personal?.pan || a.id || "").toUpperCase().trim() === targetPan
      ) ||
      (storeMasterApplicants || []).find(
        (a) => (a.pan || a.personal?.pan || a.id || "").toUpperCase().trim() === targetPan
      );

    // 2. Check localStorage ddaData
    let foundFromDdaData = null;
    try {
      const rawDdaData = JSON.parse(localStorage.getItem("ddaData") || "{}");
      if (rawDdaData?.applicants && rawDdaData.applicants[targetPan]) {
        foundFromDdaData = rawDdaData.applicants[targetPan];
      }
    } catch (_) {}

    // 3. Check localStorage dda_extension_applicants, dda_user_applicants, dda_cached_applicants
    let foundFromExt = null;
    try {
      const rawExt = JSON.parse(
        localStorage.getItem("dda_extension_applicants") ||
        localStorage.getItem("dda_user_applicants") ||
        localStorage.getItem("dda_cached_applicants") ||
        "[]"
      );
      if (Array.isArray(rawExt)) {
        foundFromExt = rawExt.find(
          (a) => (a.pan || a.personal?.pan || a.id || "").toUpperCase().trim() === targetPan
        );
      } else if (rawExt && typeof rawExt === "object" && rawExt[targetPan]) {
        foundFromExt = rawExt[targetPan];
      }
    } catch (_) {}

    // The applicant's own record (the app's copy of it) is the only source when
    // there is one: the old caches and the bundled test file would otherwise
    // fill what the record leaves empty (email, bank...) with stale or test values
    const hasOwnRecord = Boolean(foundFromStore) ||
      Boolean(rawApplicant.personal && Object.keys(rawApplicant.personal).length > 0);
    if (hasOwnRecord) {
      foundFromDdaData = null;
      foundFromExt = null;
    }

    // 4. Check offline database store (only for an applicant that is not in the app)
    const foundFromOffline = hasOwnRecord ? null : (OFFLINE_STORE?.applicants?.[targetPan] || null);

    const base = foundFromStore || foundFromExt || foundFromDdaData || foundFromOffline || rawApplicant || {};

    // Personal details merge
    const p = {
      ...(foundFromOffline?.personal || {}),
      ...(foundFromExt?.personal || {}),
      ...(foundFromDdaData?.personal || {}),
      ...(foundFromStore?.personal || {}),
      ...(rawApplicant.personal || {}),
    };

    // Bank details merge (supporting all schema variants)
    const bRaw = {
      ...(foundFromOffline?.bank || foundFromOffline?.bankDetails || {}),
      ...(foundFromExt?.bank || foundFromExt?.bankDetails || {}),
      ...(foundFromDdaData?.bank || foundFromDdaData?.bankDetails || {}),
      ...(foundFromStore?.bank || foundFromStore?.bankDetails || {}),
      ...(rawApplicant.bank || rawApplicant.bankDetails || rawApplicant.personal?.bank || {}),
    };
    const b = {
      bankId: bRaw.bankId || bRaw.bank_id || bRaw.bank || "",
      bankName: bRaw.bankName || bRaw.bank_name || bRaw.bank || "",
      accountNumber: bRaw.accountNumber || bRaw.accountNo || bRaw.account_no || bRaw.account || "",
      branchName: bRaw.branchName || bRaw.branch_name || bRaw.branch || "",
      ifscCode: (bRaw.ifscCode || bRaw.ifsc_code || bRaw.ifsc || "").toUpperCase(),
    };

    // Address details merge (supporting all schema variants)
    const aRaw = {
      ...(foundFromOffline?.address || foundFromOffline?.addressDetails || {}),
      ...(foundFromExt?.address || foundFromExt?.addressDetails || {}),
      ...(foundFromDdaData?.address || foundFromDdaData?.addressDetails || {}),
      ...(foundFromStore?.address || foundFromStore?.addressDetails || {}),
      ...(rawApplicant.address || rawApplicant.addressDetails || rawApplicant.personal?.address || {}),
    };
    const a = {
      houseNo: aRaw.houseNo || aRaw.house_no || aRaw.address || p.address || "",
      street: aRaw.street || aRaw.street_road || aRaw.addressLine2 || aRaw.address_line2 || aRaw.road || "",
      area: aRaw.area || aRaw.area_locality || aRaw.areaLocality || aRaw.city || "",
      town: aRaw.town || aRaw.town_village || aRaw.townVillage || aRaw.city || "",
      stateId: aRaw.stateId || aRaw.state_id || aRaw.state || "",
      districtId: aRaw.districtId || aRaw.district_id || aRaw.district || "",
      pinCode: aRaw.pinCode || aRaw.pincode || aRaw.pin_code || aRaw.pin || "",
      region: aRaw.region !== undefined ? aRaw.region : (aRaw.regionId || "1"),
    };

    // Preferences merge
    const pref = {
      ...(foundFromOffline?.preferences || {}),
      ...(foundFromExt?.preferences || {}),
      ...(foundFromDdaData?.preferences || {}),
      ...(foundFromStore?.preferences || {}),
      ...(rawApplicant.preferences || rawApplicant.location || {}),
    };

    // Joint Applicant merge
    const jRaw = {
      ...(foundFromOffline?.jointApplicant || {}),
      ...(foundFromExt?.jointApplicant || {}),
      ...(foundFromDdaData?.jointApplicant || {}),
      ...(foundFromStore?.jointApplicant || {}),
      ...(rawApplicant.jointApplicant || {}),
    };

    // Eligibility (Karmajeevi) merge
    const elRaw = {
      ...(foundFromOffline?.eligibility || foundFromOffline?.karmajeevi || foundFromOffline?.documents?.karmajeevi || {}),
      ...(foundFromExt?.eligibility || foundFromExt?.karmajeevi || foundFromExt?.documents?.karmajeevi || {}),
      ...(foundFromDdaData?.eligibility || foundFromDdaData?.karmajeevi || foundFromDdaData?.documents?.karmajeevi || {}),
      ...(foundFromStore?.eligibility || foundFromStore?.karmajeevi || foundFromStore?.documents?.karmajeevi || {}),
      ...(rawApplicant.eligibility || rawApplicant.karmajeevi || rawApplicant.documents?.karmajeevi || {}),
    };

    // Collect any top-level document fields
    const docKeys = [
      "empIdCard1a", "empCertificate1a", "salarySlip", "form16",
      "professionalDegreeCertificate", "incomeTaxReturn",
      "proRegCertificateIssuedDoc", "empIdCard1b", "empCertificate1b"
    ];
    docKeys.forEach((k) => {
      if (!elRaw[k]) {
        elRaw[k] = rawApplicant[k] || foundFromStore?.[k] || foundFromDdaData?.[k] || foundFromExt?.[k] || foundFromOffline?.[k] || "";
      }
    });

    if (!elRaw.paraType && (rawApplicant.paraType || rawApplicant.para_type)) {
      elRaw.paraType = rawApplicant.paraType || rawApplicant.para_type;
    }

    const photo = rawApplicant.photo || p.photo || foundFromStore?.photo || foundFromDdaData?.photo || foundFromExt?.photo || foundFromOffline?.photo || "";
    const sign = rawApplicant.sign || p.sign || foundFromStore?.sign || foundFromDdaData?.sign || foundFromExt?.sign || foundFromOffline?.sign || "";

    return {
      ...base,
      ...rawApplicant,
      personal: p,
      bank: b,
      address: a,
      preferences: pref,
      jointApplicant: jRaw,
      eligibility: elRaw,
      photo,
      sign,
    };
  }, [rawApplicant, storeApplicants, storeMasterApplicants]);

  if (!isOpen || !viewDetails || !isSchemesStage) return null;

  const p = viewDetails.personal || {};
  const b = viewDetails.bank || {};
  const a = viewDetails.address || {};
  const pref = viewDetails.preferences || {};
  const j = viewDetails.jointApplicant || {};
  const el = viewDetails.eligibility || {};
  const photo = viewDetails.photo || p.photo || "";
  const sign = viewDetails.sign || p.sign || "";

  // Karmajeevi scheme status check
  const isKaramjeevi = Boolean(
    el.enabled === true ||
    el.enabled === "1" ||
    el.enabled === 1 ||
    el.enabled === "true" ||
    el.paraType ||
    el.para_type ||
    viewDetails.is_karamjeevi_scheme === "1" ||
    viewDetails.is_karamjeevi_scheme === 1 ||
    viewDetails.is_karamjeevi_scheme === true ||
    el.empIdCard1a ||
    el.empCertificate1a ||
    el.salarySlip ||
    el.form16 ||
    el.professionalDegreeCertificate ||
    el.incomeTaxReturn ||
    el.proRegCertificateIssuedDoc ||
    el.empIdCard1b ||
    el.empCertificate1b
  );

  // Joint applicant status check
  const hasJoint = Boolean(
    j.enabled === true ||
    j.enabled === "1" ||
    j.enabled === 1 ||
    j.firstName ||
    j.pan ||
    j.relation ||
    j.relationship
  );

  const fullName = `${p.firstName || ""} ${p.middleName || ""} ${p.lastName || ""}`.replace(/\s+/g, " ").trim() || viewDetails.name || "Applicant";
  const initials = `${p.firstName?.[0] || ""}${p.lastName?.[0] || ""}`.toUpperCase() || "A";

  const bankObj = BANKS.find(
    (bk) =>
      String(bk.id) === String(b.bankId) ||
      (b.bankName && bk.label.toUpperCase() === String(b.bankName).toUpperCase()) ||
      (b.bankId && bk.label.toUpperCase().includes(String(b.bankId).toUpperCase()))
  );

  const stateObj = STATES.find(
    (st) =>
      String(st.id) === String(a.stateId) ||
      (a.stateId && st.label.toUpperCase() === String(a.stateId).toUpperCase())
  );

  const distList = stateObj?.id || a.stateId ? DISTRICTS_BY_STATE[String(stateObj?.id || a.stateId)] || [] : [];
  const distObj = distList.find(
    (dt) =>
      String(dt.id) === String(a.districtId) ||
      (a.districtId && dt.label.toUpperCase() === String(a.districtId).toUpperCase())
  );

  const catObj = CATEGORIES.find(
    (c) =>
      String(c.id) === String(p.categoryId) ||
      (p.categoryId && c.label.toUpperCase().includes(String(p.categoryId).toUpperCase()))
  );

  const locObj = LOCALITY_OPTIONS.find(
    (l) =>
      String(l.value) === String(pref.locality) ||
      (pref.locality && l.label.toUpperCase() === String(pref.locality).toUpperCase())
  );

  // Parse target flat numbers as array for individual badge pills
  const targetFlatsList = Array.isArray(pref.flatNo)
    ? pref.flatNo.map(String).filter(Boolean)
    : typeof pref.flatNo === "string" && pref.flatNo.trim()
    ? pref.flatNo.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean)
    : [];

  // Helper function to render a Karmajeevi document card
  const renderDocCard = (title, fileData, hindi) => {
    if (!fileData) return null;
    const isPdf = typeof fileData === "string" && (fileData.startsWith("data:application/pdf") || fileData.toLowerCase().includes(".pdf"));
    return (
      <div
        key={title}
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          gap: "8px",
          padding: "12px",
          background: "#ffffff",
          border: "1px solid #bbf7d0",
          borderRadius: "8px",
          boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
        }}
      >
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "6px" }}>
            <span style={{ fontSize: "11px", color: "#64748b", fontWeight: "600" }}>{hindi}</span>
            <span style={{ fontSize: "10.5px", fontWeight: "700", color: "#16a34a", background: "#f0fdf4", padding: "1.5px 6px", borderRadius: "4px", border: "1px solid #dcfce7" }}>
              ✓ Attached
            </span>
          </div>
          <span style={{ fontSize: "12px", fontWeight: "700", color: "#1e293b", display: "block", marginTop: "2px", lineHeight: "1.3" }}>
            {title}
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", borderTop: "1px solid #f1f5f9", paddingTop: "8px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "6px", minWidth: 0 }}>
            {isPdf ? (
              <span style={{ fontSize: "18px" }}>📄</span>
            ) : (
              <img
                src={fileData}
                alt={title}
                style={{ width: "32px", height: "32px", objectFit: "cover", borderRadius: "4px", border: "1px solid #cbd5e1" }}
              />
            )}
            <span style={{ fontSize: "11px", color: "#64748b", fontWeight: "600", textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap" }}>
              {isPdf ? "PDF Document" : "Image File"}
            </span>
          </div>

          <button
            type="button"
            onClick={() => setPreviewDoc({ title, data: fileData, isPdf })}
            style={{
              padding: "4px 10px",
              fontSize: "11px",
              fontWeight: "700",
              background: "#eff6ff",
              color: "#1d4ed8",
              border: "1px solid #bfdbfe",
              borderRadius: "5px",
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: "4px",
              flexShrink: 0,
            }}
          >
            👁 View
          </button>
        </div>
      </div>
    );
  };

  // 🎓 Exact DDA OR-Condition Logic for Karamjeevi Scheme Documents
  const isPara1b = el.paraType === "1b" || el.para_type === "1b";

  // Para 1(a) OR Choice 1: ID Card vs Employer Certificate
  const hasEmpCert1a = Boolean(el.empCertificate1a);
  const hasEmpId1a = Boolean(el.empIdCard1a);
  const isEmployerCert1a =
    String(el.empIdCardCertificateType) === "2" || (!hasEmpId1a && hasEmpCert1a);
  const chosenIdTypeLabel1a = isEmployerCert1a
    ? "Employer Certificate"
    : "Employee's/Pensioner's Identity Card";
  const chosenIdDoc1a = isEmployerCert1a
    ? (hasEmpCert1a ? { title: "Employer Certificate", data: el.empCertificate1a, hindi: "नियोक्ता प्रमाणपत्र (1a)" } : null)
    : (hasEmpId1a ? { title: "Employee's/Pensioner's Identity Card", data: el.empIdCard1a, hindi: "कर्मचारी पहचान पत्र (1a)" } : null);

  // Para 1(a) OR Choice 2: Salary Slip vs Form 16 (TDS Certificate)
  const hasForm16 = Boolean(el.form16);
  const hasSalarySlip = Boolean(el.salarySlip);
  const isForm16 =
    String(el.salarySlipForm16Type) === "2" || (!hasSalarySlip && hasForm16);
  const chosenSalaryTypeLabel1a = isForm16
    ? "Form 16 (TDS Certificate)"
    : "Salary Slip";
  const chosenSalaryDoc1a = isForm16
    ? (hasForm16 ? { title: "Form 16 (TDS Certificate)", data: el.form16, hindi: "फॉर्म 16 (टीडीएस प्रमाणपत्र)" } : null)
    : (hasSalarySlip ? { title: "Salary Slip", data: el.salarySlip, hindi: "वेतन विवरण" } : null);

  // Para 1(b) Documents:
  // Mandatory: Professional Degree Certificate
  // Optional OR Choices: Latest ITR, Statutory Body Reg Doc, or Employee ID / Cert 1b
  const hasEmpCert1b = Boolean(el.empCertificate1b);
  const hasEmpId1b = Boolean(el.empIdCard1b);
  const isEmployerCert1b =
    String(el.empIdCardCertificate1b) === "2" || (!hasEmpId1b && hasEmpCert1b);
  const isEmpId1b =
    String(el.empIdCardCertificate1b) === "1" || (!hasEmpCert1b && hasEmpId1b);
  const chosenIdDoc1b = isEmployerCert1b && hasEmpCert1b
    ? { title: "Employer Certificate", data: el.empCertificate1b, hindi: "नियोक्ता प्रमाणपत्र (1b)" }
    : isEmpId1b && hasEmpId1b
    ? { title: "Employee Identity Card", data: el.empIdCard1b, hindi: "कर्मचारी पहचान पत्र (1b)" }
    : null;

  // Array of strictly chosen and uploaded documents (honoring all OR conditions)
  const karmajeeviUploadedDocs = [];
  if (!isPara1b) {
    if (chosenIdDoc1a?.data) karmajeeviUploadedDocs.push(chosenIdDoc1a);
    if (chosenSalaryDoc1a?.data) karmajeeviUploadedDocs.push(chosenSalaryDoc1a);
  } else {
    if (el.professionalDegreeCertificate) {
      karmajeeviUploadedDocs.push({
        title: "Professional Degree Certificate",
        data: el.professionalDegreeCertificate,
        hindi: "व्यावसायिक डिग्री प्रमाणपत्र",
      });
    }
    if (el.incomeTaxReturn) {
      karmajeeviUploadedDocs.push({
        title: "Latest Income Tax Return (ITR)",
        data: el.incomeTaxReturn,
        hindi: "आयकर रिटर्न (ITR)",
      });
    }
    if (el.proRegCertificateIssuedDoc) {
      karmajeeviUploadedDocs.push({
        title: `Professional Registration (${getBodyLabel(el.proRegCertificateIssued)})`,
        data: el.proRegCertificateIssuedDoc,
        hindi: "व्यावसायिक पंजीकरण प्रमाणपत्र",
      });
    }
    if (chosenIdDoc1b?.data) {
      karmajeeviUploadedDocs.push(chosenIdDoc1b);
    }
  }

  // Tab definitions in exact application form sections order
  const tabs = [
    {
      id: "personal",
      label: "Personal",
      icon: (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
          <circle cx="12" cy="7" r="4"></circle>
        </svg>
      ),
    },
    {
      id: "bank",
      label: "Bank",
      icon: (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="4" width="20" height="16" rx="2"></rect>
          <line x1="2" y1="10" x2="22" y2="10"></line>
        </svg>
      ),
    },
    {
      id: "address",
      label: "Address",
      icon: (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
          <circle cx="12" cy="10" r="3"></circle>
        </svg>
      ),
    },
    {
      id: "media",
      label: "Photo/Sign",
      icon: (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
          <circle cx="8.5" cy="8.5" r="1.5"></circle>
          <polyline points="21 15 16 10 5 21"></polyline>
        </svg>
      ),
    },
    ...(hasJoint
      ? [
          {
            id: "joint",
            label: "Joint Applicant",
            icon: (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                <circle cx="9" cy="7" r="4"></circle>
                <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
              </svg>
            ),
          },
        ]
      : []),
    ...(isKaramjeevi
      ? [
          {
            id: "karmajeevi",
            label: "Karmajeevi",
            badge: karmajeeviUploadedDocs.length > 0 ? `${karmajeeviUploadedDocs.length} Uploaded` : "Enrolled",
            icon: (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                <polyline points="14 2 14 8 20 8"></polyline>
                <line x1="16" y1="13" x2="8" y2="13"></line>
                <line x1="16" y1="17" x2="8" y2="17"></line>
              </svg>
            ),
          },
        ]
      : []),
    {
      id: "preferences",
      label: "Preferences",
      icon: (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10"></circle>
          <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"></polygon>
        </svg>
      ),
    },
  ];

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: "rgba(15, 23, 42, 0.65)",
        backdropFilter: "blur(6px)",
        WebkitBackdropFilter: "blur(6px)",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        zIndex: 1000,
        padding: "12px",
        animation: "fadeInViewModal 0.2s cubic-bezier(0.16, 1, 0.3, 1)",
      }}
      onClick={onClose}
    >
      <div
        style={{
          backgroundColor: "#ffffff",
          borderRadius: "16px",
          maxWidth: "840px",
          width: "100%",
          height: "min(580px, 90vh)",
          minHeight: "min(580px, 90vh)",
          maxHeight: "90vh",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          animation: "scaleInViewModal 0.25s cubic-bezier(0.16, 1, 0.3, 1)",
          boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.25), 0 0 0 1px rgba(0,0,0,0.06)",
          position: "relative",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <style>{`
          @keyframes fadeInViewModal {
            from { opacity: 0; }
            to { opacity: 1; }
          }
          @keyframes scaleInViewModal {
            from { opacity: 0; transform: scale(0.96) translateY(8px); }
            to { opacity: 1; transform: scale(1) translateY(0); }
          }
          .view-tab-pill {
            padding: 7px 13px;
            font-size: 12.5px;
            font-weight: 500;
            color: #64748b;
            background: transparent;
            border: 1px solid transparent;
            border-radius: 8px;
            cursor: pointer;
            transition: all 0.15s ease;
            display: flex;
            align-items: center;
            gap: 6px;
            white-space: nowrap;
          }
          .view-tab-pill:hover {
            color: #4b2c83;
            background: #f1f5f9;
          }
          .view-tab-pill.active {
            color: #4b2c83;
            background: #ffffff;
            font-weight: 700;
            border: 1px solid #e2e8f0;
            box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
          }
          .panel-section-header {
            display: flex;
            align-items: center;
            margin-bottom: 12px;
            padding-bottom: 8px;
            border-bottom: 1px solid #e2e8f0;
          }
          .panel-header-badge {
            display: inline-flex;
            align-items: center;
            gap: 7px;
            font-size: 13px;
            font-weight: 700;
            color: #4b2c83;
            background: #faf5ff;
            border: 1px solid #e9d5ff;
            padding: 4px 12px;
            border-radius: 6px;
            letter-spacing: 0.2px;
          }
          .view-detail-card {
            background: #f8fafc;
            border: 1px solid #e2e8f0;
            border-radius: 8px;
            padding: 8px 12px;
            display: flex;
            flex-direction: column;
            gap: 2px;
            box-sizing: border-box;
          }
          .view-detail-label {
            font-size: 10.5px;
            font-weight: 700;
            color: #475569;
            text-transform: uppercase;
            letter-spacing: 0.4px;
          }
          .view-detail-val {
            font-size: 13px;
            font-weight: 600;
            color: #0f172a;
            word-break: break-word;
          }
          .view-grid-3 {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 10px;
          }
          .view-grid-2 {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 12px;
          }
        `}</style>

        {/* ── Modal Header ── */}
        <div
          style={{
            padding: "14px 20px",
            background: "linear-gradient(135deg, #371b69 0%, #4b2c83 60%, #63207c 100%)",
            color: "#ffffff",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            boxShadow: "0 2px 10px rgba(75, 44, 131, 0.2)",
            flexShrink: 0,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <div
              style={{
                width: "40px",
                height: "40px",
                borderRadius: "10px",
                background: "rgba(255, 255, 255, 0.2)",
                backdropFilter: "blur(8px)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontWeight: "800",
                fontSize: "15px",
                color: "#ffffff",
                border: "1px solid rgba(255, 255, 255, 0.3)",
                flexShrink: 0,
              }}
            >
              {initials}
            </div>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                <h3 style={{ margin: 0, fontSize: "16.5px", fontWeight: "700", letterSpacing: "0.2px", color: "#ffffff" }}>
                  {fullName}
                </h3>
                {p.pan && (
                  <span
                    style={{
                      fontSize: "11px",
                      background: "rgba(255, 255, 255, 0.2)",
                      border: "1px solid rgba(255, 255, 255, 0.35)",
                      padding: "2px 8px",
                      borderRadius: "5px",
                      fontWeight: "700",
                      letterSpacing: "0.5px",
                    }}
                  >
                    {p.pan}
                  </span>
                )}
                {isKaramjeevi && (
                  <span
                    style={{
                      fontSize: "10.5px",
                      background: "rgba(22, 163, 74, 0.35)",
                      border: "1px solid rgba(187, 247, 208, 0.5)",
                      color: "#f0fdf4",
                      padding: "2px 8px",
                      borderRadius: "5px",
                      fontWeight: "700",
                      letterSpacing: "0.3px",
                    }}
                  >
                    ✓ Karamjeevi Scheme
                  </span>
                )}
              </div>
              <p style={{ margin: "2px 0 0", fontSize: "12px", opacity: 0.9, color: "#f8fafc" }}>
                Applicant Details Overview
              </p>
            </div>
          </div>

          <button
            className="btn-close"
            onClick={onClose}
            style={{
              background: "rgba(255, 255, 255, 0.18)",
              border: "1px solid rgba(255, 255, 255, 0.25)",
              color: "#ffffff",
              width: "30px",
              height: "30px",
              borderRadius: "8px",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "16px",
              transition: "all 0.15s ease",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255, 255, 255, 0.3)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "rgba(255, 255, 255, 0.18)")}
            title="Close"
          >
            ✕
          </button>
        </div>

        {/* ── Tab Navigation (Strictly Ordered According to DDA Application Form Sections) ── */}
        <div
          style={{
            display: "flex",
            justifyContent: "flex-start",
            alignItems: "center",
            background: "#f8fafc",
            padding: "8px 16px",
            borderBottom: "1px solid #e2e8f0",
            gap: "6px",
            flexShrink: 0,
            overflowX: "auto",
          }}
        >
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`view-tab-pill ${activeTab === t.id ? "active" : ""}`}
              onClick={() => setActiveTab(t.id)}
            >
              {t.icon}
              <span>{t.label}</span>
              {t.badge && (
                <span
                  style={{
                    fontSize: "9.5px",
                    fontWeight: "700",
                    background: activeTab === t.id ? "#16a34a" : "#22c55e",
                    color: "#ffffff",
                    padding: "1px 6px",
                    borderRadius: "8px",
                    marginLeft: "2px",
                  }}
                >
                  ✓
                </span>
              )}
            </button>
          ))}
        </div>

        {/* ── Tab Body (Scrollable Fixed Height Container) ── */}
        <div
          style={{
            padding: "16px 20px",
            flex: "1 1 auto",
            display: "flex",
            flexDirection: "column",
            justifyContent: "flex-start",
            background: "#fafbfc",
            overflowY: "auto",
          }}
        >
          {/* ========================================================================= */}
          {/* SECTION 1: PERSONAL DETAILS (Application Form Sequence) */}
          {/* ========================================================================= */}
          {activeTab === "personal" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "10px", background: "#ffffff", padding: "14px 18px", borderRadius: "12px", border: "1px solid #e2e8f0" }}>
              <div className="panel-section-header">
                <span className="panel-header-badge">1. Personal Details</span>
              </div>

              {/* Row 1: Full Name, Father's Name, Mother's Name */}
              <div className="view-grid-3">
                <div className="view-detail-card">
                  <span className="view-detail-label">Full Name</span>
                  <span className="view-detail-val">{fullName}</span>
                </div>
                <div className="view-detail-card">
                  <span className="view-detail-label">Father's Name</span>
                  <span className="view-detail-val">{p.fatherName || "—"}</span>
                </div>
                <div className="view-detail-card">
                  <span className="view-detail-label">Mother's Name</span>
                  <span className="view-detail-val">{p.motherName || "—"}</span>
                </div>
              </div>

              {/* Row 2: DOB, Gender, Nationality */}
              <div className="view-grid-3">
                <div className="view-detail-card">
                  <span className="view-detail-label">Date of Birth (DOB)</span>
                  <span className="view-detail-val">{p.dob || "—"}</span>
                </div>
                <div className="view-detail-card">
                  <span className="view-detail-label">Gender</span>
                  <span className="view-detail-val">
                    {String(p.gender || "M").toUpperCase().startsWith("F")
                      ? "Female"
                      : String(p.gender || "M").toUpperCase().startsWith("T")
                      ? "Transgender"
                      : "Male"}
                  </span>
                </div>
                <div className="view-detail-card">
                  <span className="view-detail-label">Nationality</span>
                  <span className="view-detail-val">{String(p.nationality) === "2" ? "Other" : "Indian"}</span>
                </div>
              </div>

              {/* Row 3: Marital Status, Spouse Name, Category */}
              <div className="view-grid-3">
                <div className="view-detail-card">
                  <span className="view-detail-label">Marital Status</span>
                  <span className="view-detail-val">
                    {String(p.maritalStatus) === "2" || String(p.maritalStatus || "").toUpperCase().includes("MARR")
                      ? "Married"
                      : "Single"}
                  </span>
                </div>
                <div className="view-detail-card">
                  <span className="view-detail-label">Spouse Name</span>
                  <span className="view-detail-val">{p.spouseName || "—"}</span>
                </div>
                <div className="view-detail-card">
                  <span className="view-detail-label">Category</span>
                  <span className="view-detail-val">{catObj?.label || p.categoryId || "General"}</span>
                </div>
              </div>

              {/* Row 4: PAN Number, Aadhar Number, Mobile Number */}
              <div className="view-grid-3">
                <div className="view-detail-card">
                  <span className="view-detail-label">PAN Number</span>
                  <span className="view-detail-val" style={{ fontWeight: "700" }}>
                    {p.pan || "—"}
                  </span>
                </div>
                <div className="view-detail-card">
                  <span className="view-detail-label">Aadhar Number</span>
                  <span className="view-detail-val">{p.aadhar || "—"}</span>
                </div>
                <div className="view-detail-card">
                  <span className="view-detail-label">Mobile Number</span>
                  <span className="view-detail-val">{p.mobile || "—"}</span>
                </div>
              </div>

              {/* Row 5: Email ID, STD / Phone, Physically Disabled (PwD) */}
              <div className="view-grid-3">
                <div className="view-detail-card">
                  <span className="view-detail-label">Email ID</span>
                  <span className="view-detail-val">{p.email || "—"}</span>
                </div>
                <div className="view-detail-card">
                  <span className="view-detail-label">STD Code / Phone</span>
                  <span className="view-detail-val">
                    {p.phone ? `${p.stdCode ? `${p.stdCode}-` : ""}${p.phone}` : "—"}
                  </span>
                </div>
                <div className="view-detail-card">
                  <span className="view-detail-label">Physically Disabled (PwD)</span>
                  <span className="view-detail-val">
                    {p.isPhysicallyDisabled === "1" || p.isPhysicallyDisabled === true ? "Yes" : "No"}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* ========================================================================= */}
          {/* SECTION 2: BANK DETAILS (Application Form Sequence) */}
          {/* ========================================================================= */}
          {activeTab === "bank" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "10px", background: "#ffffff", padding: "14px 18px", borderRadius: "12px", border: "1px solid #e2e8f0" }}>
              <div className="panel-section-header">
                <span className="panel-header-badge">2. Bank Details</span>
              </div>

              <div className="view-grid-2">
                <div className="view-detail-card">
                  <span className="view-detail-label">Bank Name</span>
                  <span className="view-detail-val">{bankObj?.label || b.bankName || b.bankId || "—"}</span>
                </div>
                <div className="view-detail-card">
                  <span className="view-detail-label">Branch Name</span>
                  <span className="view-detail-val">{b.branchName || "—"}</span>
                </div>
              </div>

              <div className="view-grid-2">
                <div className="view-detail-card">
                  <span className="view-detail-label">IFSC Code</span>
                  <span className="view-detail-val" style={{ textTransform: "uppercase", fontWeight: "700" }}>
                    {b.ifscCode || "—"}
                  </span>
                </div>
                <div className="view-detail-card">
                  <span className="view-detail-label">Account Number</span>
                  <span className="view-detail-val">{b.accountNumber || "—"}</span>
                </div>
              </div>
            </div>
          )}

          {/* ========================================================================= */}
          {/* SECTION 3: ADDRESS DETAILS (Application Form Sequence) */}
          {/* ========================================================================= */}
          {activeTab === "address" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "10px", background: "#ffffff", padding: "14px 18px", borderRadius: "12px", border: "1px solid #e2e8f0" }}>
              <div className="panel-section-header">
                <span className="panel-header-badge">3. Correspondence Address Details</span>
              </div>

              <div className="view-grid-2">
                <div className="view-detail-card">
                  <span className="view-detail-label">House / Flat No</span>
                  <span className="view-detail-val">{a.houseNo || "—"}</span>
                </div>
                <div className="view-detail-card">
                  <span className="view-detail-label">Street / Locality</span>
                  <span className="view-detail-val">{a.street || "—"}</span>
                </div>
              </div>

              <div className="view-grid-2">
                <div className="view-detail-card">
                  <span className="view-detail-label">Area / Sector</span>
                  <span className="view-detail-val">{a.area || "—"}</span>
                </div>
                <div className="view-detail-card">
                  <span className="view-detail-label">Town / City / Village</span>
                  <span className="view-detail-val">{a.town || "—"}</span>
                </div>
              </div>

              <div className="view-grid-2">
                <div className="view-detail-card">
                  <span className="view-detail-label">State</span>
                  <span className="view-detail-val">{stateObj?.label || a.stateId || "—"}</span>
                </div>
                <div className="view-detail-card">
                  <span className="view-detail-label">District</span>
                  <span className="view-detail-val">{distObj?.label || a.districtId || "—"}</span>
                </div>
              </div>

              <div className="view-grid-2">
                <div className="view-detail-card">
                  <span className="view-detail-label">PIN Code</span>
                  <span className="view-detail-val">{a.pinCode || "—"}</span>
                </div>
                <div className="view-detail-card">
                  <span className="view-detail-label">Region</span>
                  <span className="view-detail-val">{String(a.region) === "2" ? "Outside Delhi" : "Delhi"}</span>
                </div>
              </div>
            </div>
          )}

          {/* ========================================================================= */}
          {/* SECTION 4: PHOTO & SIGNATURE (Application Form Sequence) */}
          {/* ========================================================================= */}
          {activeTab === "media" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "14px", background: "#ffffff", padding: "14px 18px", borderRadius: "12px", border: "1px solid #e2e8f0" }}>
              <div className="panel-section-header">
                <span className="panel-header-badge">4. Photo & Signature</span>
              </div>

              <div className="view-grid-2">
                <div className="view-detail-card" style={{ alignItems: "center", textAlign: "center", padding: "14px" }}>
                  <span className="view-detail-label" style={{ marginBottom: "8px" }}>Applicant Photograph</span>
                  {photo ? (
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "8px" }}>
                      <img
                        src={photo}
                        alt="Applicant Photo"
                        style={{
                          width: "120px",
                          height: "140px",
                          objectFit: "cover",
                          borderRadius: "8px",
                          border: "1px solid #cbd5e1",
                          boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => setPreviewDoc({ title: "Applicant Photograph", data: photo, isPdf: false })}
                        style={{
                          padding: "3px 10px",
                          fontSize: "11px",
                          fontWeight: "700",
                          background: "#eff6ff",
                          color: "#1d4ed8",
                          border: "1px solid #bfdbfe",
                          borderRadius: "5px",
                          cursor: "pointer",
                        }}
                      >
                        👁 View Full Photo
                      </button>
                    </div>
                  ) : (
                    <div style={{ width: "120px", height: "140px", display: "flex", alignItems: "center", justifyContent: "center", color: "#94a3b8", fontSize: "12px", border: "1px dashed #cbd5e1", borderRadius: "8px" }}>
                      No Photo Attached
                    </div>
                  )}
                </div>

                <div className="view-detail-card" style={{ alignItems: "center", textAlign: "center", padding: "14px" }}>
                  <span className="view-detail-label" style={{ marginBottom: "8px" }}>Applicant Signature</span>
                  {sign ? (
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "8px" }}>
                      <img
                        src={sign}
                        alt="Applicant Signature"
                        style={{
                          width: "180px",
                          height: "140px",
                          objectFit: "contain",
                          borderRadius: "8px",
                          border: "1px solid #cbd5e1",
                          boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => setPreviewDoc({ title: "Applicant Signature", data: sign, isPdf: false })}
                        style={{
                          padding: "3px 10px",
                          fontSize: "11px",
                          fontWeight: "700",
                          background: "#eff6ff",
                          color: "#1d4ed8",
                          border: "1px solid #bfdbfe",
                          borderRadius: "5px",
                          cursor: "pointer",
                        }}
                      >
                        👁 View Full Signature
                      </button>
                    </div>
                  ) : (
                    <div style={{ width: "180px", height: "140px", display: "flex", alignItems: "center", justifyContent: "center", color: "#94a3b8", fontSize: "12px", border: "1px dashed #cbd5e1", borderRadius: "8px" }}>
                      No Signature Attached
                    </div>
                  )}
                </div>
              </div>

              {/* Karamjeevi Summary Banner inside Media */}
              {isKaramjeevi && (
                <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", padding: "12px 14px", borderRadius: "8px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <span style={{ fontSize: "16px" }}>🎓</span>
                    <div>
                      <span style={{ fontSize: "12px", fontWeight: "700", color: "#166534", display: "block" }}>
                        Karamjeevi Scheme Eligibility Documents Attached
                      </span>
                      <span style={{ fontSize: "11px", color: "#15803d" }}>
                        Category: {isPara1b ? "Para 2.4(b) Professional / Consultant" : "Para 2.4(a) Salaried Employee"}
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setActiveTab("karmajeevi")}
                    style={{
                      padding: "4px 12px",
                      fontSize: "11.5px",
                      fontWeight: "700",
                      background: "#16a34a",
                      color: "#ffffff",
                      border: "none",
                      borderRadius: "6px",
                      cursor: "pointer",
                    }}
                  >
                    View Documents →
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ========================================================================= */}
          {/* SECTION 5: JOINT APPLICANT DETAILS (Application Form Sequence) */}
          {/* ========================================================================= */}
          {activeTab === "joint" && hasJoint && (
            <div style={{ display: "flex", flexDirection: "column", gap: "10px", background: "#ffffff", padding: "14px 18px", borderRadius: "12px", border: "1px solid #e2e8f0" }}>
              <div className="panel-section-header">
                <span className="panel-header-badge">5. Joint Applicant Details</span>
              </div>

              {/* Row 1: Relation, Full Name, Gender */}
              <div className="view-grid-3">
                <div className="view-detail-card">
                  <span className="view-detail-label">Relation with Applicant</span>
                  <span className="view-detail-val">{j.relation || j.relationship || "—"}</span>
                </div>
                <div className="view-detail-card">
                  <span className="view-detail-label">Full Name</span>
                  <span className="view-detail-val">
                    {`${j.firstName || ""} ${j.middleName || ""} ${j.lastName || ""}`.trim() || "—"}
                  </span>
                </div>
                <div className="view-detail-card">
                  <span className="view-detail-label">Gender</span>
                  <span className="view-detail-val">
                    {String(j.gender || "M").toUpperCase().startsWith("F") ? "Female" : "Male"}
                  </span>
                </div>
              </div>

              {/* Row 2: Father's Name, Mother's Name, DOB */}
              <div className="view-grid-3">
                <div className="view-detail-card">
                  <span className="view-detail-label">Father's Name</span>
                  <span className="view-detail-val">{j.fatherName || "—"}</span>
                </div>
                <div className="view-detail-card">
                  <span className="view-detail-label">Mother's Name</span>
                  <span className="view-detail-val">{j.motherName || "—"}</span>
                </div>
                <div className="view-detail-card">
                  <span className="view-detail-label">Date of Birth (DOB)</span>
                  <span className="view-detail-val">{j.dob || "—"}</span>
                </div>
              </div>

              {/* Row 3: Marital Status, Spouse Name, Category */}
              <div className="view-grid-3">
                <div className="view-detail-card">
                  <span className="view-detail-label">Marital Status</span>
                  <span className="view-detail-val">{String(j.maritalStatus) === "2" ? "Married" : "Single"}</span>
                </div>
                <div className="view-detail-card">
                  <span className="view-detail-label">Spouse Name</span>
                  <span className="view-detail-val">{j.spouseName || "—"}</span>
                </div>
                <div className="view-detail-card">
                  <span className="view-detail-label">Category</span>
                  <span className="view-detail-val">{j.categoryId || j.category || "General"}</span>
                </div>
              </div>

              {/* Row 4: PAN Number, Aadhar Number, Mobile Number */}
              <div className="view-grid-3">
                <div className="view-detail-card">
                  <span className="view-detail-label">PAN Number</span>
                  <span className="view-detail-val" style={{ fontWeight: "700" }}>{j.pan || "—"}</span>
                </div>
                <div className="view-detail-card">
                  <span className="view-detail-label">Aadhar Number</span>
                  <span className="view-detail-val">{j.aadhar || "—"}</span>
                </div>
                <div className="view-detail-card">
                  <span className="view-detail-label">Mobile Number</span>
                  <span className="view-detail-val">{j.mobile || "—"}</span>
                </div>
              </div>

              {/* Row 5: Email ID & Joint Documents */}
              <div className="view-grid-3">
                <div className="view-detail-card">
                  <span className="view-detail-label">Email ID</span>
                  <span className="view-detail-val">{j.email || "—"}</span>
                </div>
                <div className="view-detail-card">
                  <span className="view-detail-label">Joint Photograph</span>
                  <span className="view-detail-val">
                    {j.photo ? (
                      <button
                        type="button"
                        onClick={() => setPreviewDoc({ title: "Joint Photograph", data: j.photo, isPdf: false })}
                        style={{ padding: "2px 8px", fontSize: "11px", fontWeight: "700", background: "#eff6ff", color: "#1d4ed8", border: "1px solid #bfdbfe", borderRadius: "4px", cursor: "pointer" }}
                      >
                        👁 View Photo
                      </button>
                    ) : "—"}
                  </span>
                </div>
                <div className="view-detail-card">
                  <span className="view-detail-label">Joint Signature</span>
                  <span className="view-detail-val">
                    {j.sign ? (
                      <button
                        type="button"
                        onClick={() => setPreviewDoc({ title: "Joint Signature", data: j.sign, isPdf: false })}
                        style={{ padding: "2px 8px", fontSize: "11px", fontWeight: "700", background: "#eff6ff", color: "#1d4ed8", border: "1px solid #bfdbfe", borderRadius: "4px", cursor: "pointer" }}
                      >
                        👁 View Signature
                      </button>
                    ) : "—"}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* ========================================================================= */}
          {/* SECTION 6: KARMAJEEVI SCHEME ELIGIBILITY DOCUMENTS */}
          {/* STRICTLY SHOWING ONLY CHOSEN CATEGORIES & UPLOADED DOCUMENTS (HONORING ALL OR CONDITIONS) */}
          {/* ========================================================================= */}
          {activeTab === "karmajeevi" && isKaramjeevi && (
            <div style={{ display: "flex", flexDirection: "column", gap: "12px", background: "#ffffff", padding: "14px 18px", borderRadius: "12px", border: "1px solid #e2e8f0" }}>
              <div className="panel-section-header">
                <span className="panel-header-badge">6. Karamjeevi Scheme Eligibility Documents</span>
              </div>

              {/* 1. Scheme Category & Selected Para Type */}
              <div className="view-grid-2">
                <div className="view-detail-card">
                  <span className="view-detail-label">Scheme Category</span>
                  <span className="view-detail-val" style={{ color: "#16a34a", fontWeight: "700" }}>
                    ✓ DDA Karamjeevi Scheme Enrolled
                  </span>
                </div>
                <div className="view-detail-card">
                  <span className="view-detail-label">Selected Category as per Para 2.4</span>
                  <span className="view-detail-val" style={{ fontWeight: "700" }}>
                    {isPara1b
                      ? "Individuals covered under Para 2.4(b) - Professional / Consultant"
                      : "Individuals covered under Para 2.4(a) - Salaried Employee"}
                  </span>
                </div>
              </div>

              {/* 2. Chosen Category Selections Summary (STRICTLY ONLY WHAT WAS CHOSEN) */}
              {isPara1b ? (
                /* Para 1(b) Professional selections */
                ((el.proRegCertificateIssued || el.proRegCertificateIssuedDoc) || (chosenIdDoc1b || el.empIdCardCertificate1b)) ? (
                  <div className="view-grid-2">
                    {(el.proRegCertificateIssued || el.proRegCertificateIssuedDoc) && (
                      <div className="view-detail-card">
                        <span className="view-detail-label">Selected Statutory / Professional Body</span>
                        <span className="view-detail-val">
                          {el.proRegCertificateIssued === "other"
                            ? `Other: ${el.otherProRegCertificateIssued || "Not specified"}`
                            : getBodyLabel(el.proRegCertificateIssued)}
                        </span>
                      </div>
                    )}
                    {(chosenIdDoc1b || el.empIdCardCertificate1b) && (
                      <div className="view-detail-card">
                        <span className="view-detail-label">Selected ID / Employer Document Choice</span>
                        <span className="view-detail-val">
                          {isEmployerCert1b ? "Employer Certificate" : "Employee Identity Card"}
                        </span>
                      </div>
                    )}
                  </div>
                ) : null
              ) : (
                /* Para 1(a) Salaried Employee selections */
                <div className="view-grid-2">
                  <div className="view-detail-card">
                    <span className="view-detail-label">Selected Identity Document Choice</span>
                    <span className="view-detail-val" style={{ fontWeight: "700" }}>
                      {chosenIdTypeLabel1a}
                    </span>
                  </div>
                  <div className="view-detail-card">
                    <span className="view-detail-label">Selected Income Document Choice</span>
                    <span className="view-detail-val" style={{ fontWeight: "700" }}>
                      {chosenSalaryTypeLabel1a}
                    </span>
                  </div>
                </div>
              )}

              {/* 3. Attached Documents (STRICTLY ONLY CHOSEN AND UPLOADED DOCUMENTS) */}
              <div style={{ marginTop: "4px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                  <span style={{ fontSize: "11.5px", fontWeight: "700", color: "#475569", textTransform: "uppercase", letterSpacing: "0.4px" }}>
                    Uploaded Eligibility Documents ({isPara1b ? "Para 2.4(b)" : "Para 2.4(a)"})
                  </span>
                  <span style={{ fontSize: "11px", fontWeight: "700", color: "#16a34a", background: "#f0fdf4", border: "1px solid #bbf7d0", padding: "2px 8px", borderRadius: "10px" }}>
                    {karmajeeviUploadedDocs.length} {karmajeeviUploadedDocs.length === 1 ? "Document" : "Documents"} Uploaded
                  </span>
                </div>

                {karmajeeviUploadedDocs.length > 0 ? (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "10px" }}>
                    {karmajeeviUploadedDocs.map((doc) => renderDocCard(doc.title, doc.data, doc.hindi))}
                  </div>
                ) : (
                  <div style={{ padding: "16px", background: "#f8fafc", border: "1px dashed #cbd5e1", borderRadius: "8px", textAlign: "center", color: "#64748b", fontSize: "12px" }}>
                    No uploaded eligibility documents found for this applicant under the selected category.
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ========================================================================= */}
          {/* SECTION 7: LOCATION PREFERENCES (Application Form Sequence) */}
          {/* ========================================================================= */}
          {activeTab === "preferences" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "12px", background: "#ffffff", padding: "14px 18px", borderRadius: "12px", border: "1px solid #e2e8f0" }}>
              <div className="panel-section-header">
                <span className="panel-header-badge">Location Preferences</span>
              </div>

              {/* Row 1: Target Locality, Sector, Pocket */}
              <div className="view-grid-3">
                <div className="view-detail-card">
                  <span className="view-detail-label">Target Locality</span>
                  <span className="view-detail-val">{locObj?.label || pref.locality || "—"}</span>
                </div>
                <div className="view-detail-card">
                  <span className="view-detail-label">Sector</span>
                  <span className="view-detail-val">{pref.sector || "—"}</span>
                </div>
                <div className="view-detail-card">
                  <span className="view-detail-label">Pocket</span>
                  <span className="view-detail-val">{pref.pocket || "—"}</span>
                </div>
              </div>

              {/* Row 2: Block, Tower */}
              <div className="view-grid-2">
                <div className="view-detail-card">
                  <span className="view-detail-label">Block</span>
                  <span className="view-detail-val">{pref.block || "—"}</span>
                </div>
                <div className="view-detail-card">
                  <span className="view-detail-label">Tower</span>
                  <span className="view-detail-val">{pref.tower || "—"}</span>
                </div>
              </div>

              {/* Row 3 (NEW LINE): Target Flat No(s) on its own separate line after Block and Tower */}
              <div className="view-detail-card" style={{ marginTop: "2px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                  <span className="view-detail-label">Target Flat No(s)</span>
                  <span
                    style={{
                      fontSize: "11px",
                      fontWeight: "700",
                      color: "#4b2c83",
                      background: "#faf5ff",
                      border: "1px solid #e9d5ff",
                      padding: "1px 8px",
                      borderRadius: "10px",
                    }}
                  >
                    {targetFlatsList.length} {targetFlatsList.length === 1 ? "Flat" : "Flats"}
                  </span>
                </div>

                <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", alignItems: "center" }}>
                  {targetFlatsList.length > 0 ? (
                    targetFlatsList.map((flat, idx) => (
                      <span
                        key={idx}
                        style={{
                          fontSize: "12px",
                          fontWeight: "700",
                          color: "#4338ca",
                          background: "linear-gradient(135deg, #eef2ff 0%, #e0e7ff 100%)",
                          border: "1px solid #c7d2fe",
                          padding: "3px 10px",
                          borderRadius: "6px",
                          display: "inline-flex",
                          alignItems: "center",
                          boxShadow: "0 1px 2px rgba(99, 102, 241, 0.05)",
                          letterSpacing: "0.2px",
                        }}
                      >
                        #{flat}
                      </span>
                    ))
                  ) : (
                    <span style={{ fontSize: "13px", color: "#94a3b8", fontStyle: "italic" }}>
                      None specified
                    </span>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ── Footer with Strictly Close Button ── */}
        <div
          style={{
            padding: "12px 22px",
            background: "#ffffff",
            borderTop: "1px solid #e2e8f0",
            display: "flex",
            justifyContent: "flex-end",
            alignItems: "center",
            flexShrink: 0,
          }}
        >
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onClose}
            style={{
              background: "#f1f5f9",
              border: "1px solid #cbd5e1",
              color: "#475569",
              padding: "8px 22px",
              borderRadius: "8px",
              fontSize: "13px",
              fontWeight: "600",
              cursor: "pointer",
            }}
          >
            Close
          </button>
        </div>

        {/* ── Document Inspection Preview Overlay ── */}
        {previewDoc && (
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: "rgba(15, 23, 42, 0.8)",
              backdropFilter: "blur(6px)",
              WebkitBackdropFilter: "blur(6px)",
              zIndex: 1100,
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
              animation: "fadeInViewModal 0.15s ease",
            }}
            onClick={() => setPreviewDoc(null)}
          >
            {/* Preview Header */}
            <div
              style={{
                padding: "12px 18px",
                background: "#1e293b",
                color: "#ffffff",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                borderBottom: "1px solid #334155",
                flexShrink: 0,
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <span style={{ fontSize: "16px" }}>{previewDoc.isPdf ? "📄" : "🖼️"}</span>
                <span style={{ fontSize: "14px", fontWeight: "700", letterSpacing: "0.2px" }}>
                  {previewDoc.title}
                </span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <a
                  href={previewDoc.data}
                  download={previewDoc.title}
                  style={{
                    padding: "4px 12px",
                    fontSize: "12px",
                    fontWeight: "700",
                    background: "#334155",
                    color: "#ffffff",
                    borderRadius: "6px",
                    border: "1px solid #475569",
                    textDecoration: "none",
                    cursor: "pointer",
                  }}
                >
                  Download
                </a>
                <button
                  type="button"
                  onClick={() => setPreviewDoc(null)}
                  style={{
                    padding: "4px 10px",
                    fontSize: "12px",
                    fontWeight: "700",
                    background: "#ef4444",
                    color: "#ffffff",
                    border: "none",
                    borderRadius: "6px",
                    cursor: "pointer",
                  }}
                >
                  ✕ Close
                </button>
              </div>
            </div>

            {/* Preview Content */}
            <div
              style={{
                flex: 1,
                padding: "16px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                overflow: "auto",
                background: "#0f172a",
              }}
              onClick={(e) => e.stopPropagation()}
            >
              {previewDoc.isPdf ? (
                <PdfPages data={previewDoc.data} />
              ) : (
                <img
                  src={previewDoc.data}
                  alt={previewDoc.title}
                  style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", borderRadius: "8px" }}
                />
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
