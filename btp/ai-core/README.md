# SAP AI Core — 24h excursion-risk model

1. **Train** – `pip install -r requirements.txt && python train.py` → `model/model.joblib`.
   Replace `load_data()` with a HANA Cloud query once real excursion history exists.
2. **Upload** the `model/` folder to the object store registered in AI Core
   (`ai-core/v2/admin/objectStoreSecrets`) and register it as an artifact
   (scenario `intelliops-coldchain`, kind `model`).
3. **Image** – `docker build -t <user>/intelliops-risk:1.0.0 . && docker push …`;
   add the registry secret `intelliops-docker-secret` in AI Core.
4. **Serve** – commit `serving-template.yaml` to the Git repo onboarded to AI Core,
   create a configuration binding the `riskmodel` artifact, then create a deployment.
5. **Connect CAP** – create a BTP destination `AICORE` (OAuth2ClientCredentials from
   the AI Core service key, URL = `AI_API_URL`) and set
   `cds_intelliops_aicore_deploymentId=<deployment id>` on the `intelliops-srv` app.

Joule-style questions use a separate generative AI hub deployment (e.g. gpt-4o);
set `cds_intelliops_joule_deploymentId` to that deployment's id.
