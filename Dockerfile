FROM node:22-slim
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src

# Circuits: public platform artifacts, downloaded at build time
# (not committed to the repo). Layout must stay /app/circuits:
# the prover resolves them relative to src/ (.. + .. + circuits).
RUN mkdir -p /app/circuits && cd /app/circuits && \
  curl -fsSL -o gatekeeper.wasm https://agentgames.zkverify.io/circuits/gatekeeper.wasm && \
  curl -fsSL -o gatekeeper_final.zkey https://agentgames.zkverify.io/circuits/gatekeeper_final.zkey && \
  curl -fsSL -o vfy-policy.wasm https://agentgames.zkverify.io/circuits/vfy-policy.wasm && \
  curl -fsSL -o vfy-policy_final.zkey https://agentgames.zkverify.io/circuits/vfy-policy_final.zkey

# Export verification keys with the project's snarkjs (verified: zkev).
RUN ./node_modules/.bin/snarkjs zkev /app/circuits/gatekeeper_final.zkey /app/circuits/gatekeeper_vk.json && \
    ./node_modules/.bin/snarkjs zkev /app/circuits/vfy-policy_final.zkey /app/circuits/vfy-policy_vk.json

ENV PORT=8080
EXPOSE 8080
CMD ["node", "src/server.mjs"]
