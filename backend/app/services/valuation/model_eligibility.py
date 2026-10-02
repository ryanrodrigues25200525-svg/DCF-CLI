from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

CompanyType = Literal["operating", "bank", "insurance", "reit", "utility", "asset_manager", "high_growth", "distressed"]
CompanySubtype = Literal[
    "commercial_bank", "investment_bank", "other_financial",
    "traditional_asset_manager", "alternative_asset_manager",
    "pc_insurer", "life_insurer", "reinsurer", "other_insurer",
    "equity_reit", "mortgage_reit", "other_reit",
    "regulated_utility", "mixed_utility", "merchant_utility",
]
OperatingArchetype = Literal[
    "standard_operating",
    "technology_hardware",
    "subscription_software",
    "consumer_retail",
    "industrial_manufacturing",
    "semiconductor",
    "energy_materials",
    "telecommunications",
    "mature_pharma",
    "biotechnology",
    "unclassified_operating",
]
PreferredModel = Literal[
    "unlevered_dcf",
    "levered_dcf",
    "ddm",
    "residual_income",
    "bank_residual_income",
    "insurance_pnc_residual_income",
    "reit_affo",
    "utility_dcf",
    "revenue_multiple",
    "ev_ebitda",
    "asset_manager_aum_dcf",
    "telecom_subscriber_dcf",
    "mortgage_reit_residual_income",
    "integrated_energy_dcf",
    "mature_pharma_product_dcf",
    "biotech_pipeline_rnpv",
    "life_insurer_distributable_earnings_dcf",
    "ptbv",
    "pbv",
    "nav",
    "dividend_yield",
]
ModelBuildStatus = Literal["ready", "input_required", "unsupported"]
PRODUCTION_MODEL_ROUTES = frozenset({
    "unlevered_dcf",
    "ev_ebitda",
    "revenue_multiple",
    "bank_residual_income",
    "insurance_pnc_residual_income",
    "reit_affo",
    "utility_dcf",
    "asset_manager_aum_dcf",
    "telecom_subscriber_dcf",
    "mortgage_reit_residual_income",
    "integrated_energy_dcf",
    "mature_pharma_product_dcf",
    "biotech_pipeline_rnpv",
    "life_insurer_distributable_earnings_dcf",
})


class BlockedModel(BaseModel):
    model_config = ConfigDict(extra="forbid")

    model: PreferredModel
    reason: str


class ModelReadinessGap(BaseModel):
    model_config = ConfigDict(extra="forbid")

    key: str = Field(min_length=1)
    label: str = Field(min_length=1)
    reason: str = Field(min_length=1)


class ModelEligibility(BaseModel):
    """Authoritative company classification and the model supported for it."""

    model_config = ConfigDict(extra="forbid")

    company_type: CompanyType
    preferred_model: PreferredModel
    subtype: CompanySubtype | None = None
    operating_archetype: OperatingArchetype | None = None
    status: ModelBuildStatus
    model_route_available: bool
    missing_input_gaps: list[ModelReadinessGap] = Field(default_factory=list)
    required_input_readiness: dict[str, bool] = Field(default_factory=dict)
    allowed_models: list[PreferredModel] = Field(default_factory=list)
    blocked_models: list[BlockedModel] = Field(default_factory=list)
    supported_by_current_engine: bool

    @model_validator(mode="before")
    @classmethod
    def fill_build_status(cls, value: Any) -> Any:
        if not isinstance(value, dict):
            return value

        preferred_model = value.get("preferred_model")
        allowed_models = value.get("allowed_models")
        allowed_models = allowed_models if isinstance(allowed_models, list) else []
        supported = value.get("supported_by_current_engine") is True
        route_available = value.get("model_route_available")
        if not isinstance(route_available, bool):
            route_available = supported or preferred_model in allowed_models
            value["model_route_available"] = route_available

        status = value.get("status")
        if status is None:
            status = "ready" if supported else "input_required" if route_available else "unsupported"
            value["status"] = status

        if "missing_input_gaps" not in value:
            gaps: list[dict[str, str]] = []
            readiness = value.get("required_input_readiness")
            if status == "input_required" and isinstance(readiness, dict):
                blocked_models = value.get("blocked_models")
                blocked_models = blocked_models if isinstance(blocked_models, list) else []
                route_reason = "A required model input is not source-ready."
                for item in blocked_models:
                    if isinstance(item, BlockedModel) and item.model == preferred_model:
                        route_reason = item.reason
                        break
                    if isinstance(item, dict) and item.get("model") == preferred_model:
                        reason = item.get("reason")
                        if isinstance(reason, str) and reason.strip():
                            route_reason = reason
                            break
                for key, ready in readiness.items():
                    if ready is False and isinstance(key, str) and key.strip():
                        label = " ".join(part.capitalize() for part in key.split("_") if part)
                        gaps.append({"key": key, "label": label, "reason": route_reason})
                if not gaps:
                    gaps.append({
                        "key": "valuation_readiness",
                        "label": "Valuation readiness",
                        "reason": route_reason,
                    })
            value["missing_input_gaps"] = gaps
        return value

    @model_validator(mode="after")
    def validate_production_routes(self) -> ModelEligibility:
        if any(model not in PRODUCTION_MODEL_ROUTES for model in self.allowed_models):
            raise ValueError("allowed_models may contain only production calculation and workbook routes")
        if self.status == "ready":
            if not self.supported_by_current_engine or not self.model_route_available:
                raise ValueError("a ready model must have a supported production route")
            if self.preferred_model not in PRODUCTION_MODEL_ROUTES or self.preferred_model not in self.allowed_models:
                raise ValueError("a ready model must include its preferred production route in allowed_models")
            if self.missing_input_gaps:
                raise ValueError("a ready model cannot have missing input gaps")
        elif self.status == "input_required":
            if self.supported_by_current_engine or not self.model_route_available:
                raise ValueError("an input-required model must have a route but cannot be ready to value")
            if self.preferred_model not in PRODUCTION_MODEL_ROUTES or self.preferred_model not in self.allowed_models:
                raise ValueError("an input-required model must include its preferred production route in allowed_models")
            if not self.missing_input_gaps:
                raise ValueError("an input-required model must identify at least one readiness gap")
        elif self.supported_by_current_engine or self.model_route_available or self.allowed_models:
            raise ValueError("an unsupported model cannot claim a production route")
        return self
