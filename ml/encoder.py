"""Hybrid kinematic and temporal encoder with train-only normalization."""

import numpy as np
import torch
from torch import nn
from torch.nn import functional as F


class Encoder(nn.Module):
    def __init__(self, attention=False):
        super().__init__()
        self.register_buffer("center", torch.zeros(36))
        self.register_buffer("scale", torch.ones(36))
        self.register_buffer("seq_center", torch.zeros(6))
        self.register_buffer("seq_scale", torch.ones(6))
        self.stats = nn.Sequential(nn.Linear(36, 128), nn.LayerNorm(128), nn.SiLU())
        self.residual = nn.Sequential(
            nn.Linear(128, 128), nn.LayerNorm(128), nn.SiLU(), nn.Dropout(0.12)
        )
        self.temporal = nn.Sequential(
            nn.Conv1d(6, 48, 5, padding=2),
            nn.SiLU(),
            nn.Conv1d(48, 128, 5, padding=2),
            nn.SiLU(),
        )
        self.attention = nn.Conv1d(128, 1, 1) if attention else None
        self.fusion = nn.Linear(256, 128)

    def fit_scaler(self, stats, sequences):
        for data, center, scale in (
            (stats, self.center, self.scale),
            (sequences.reshape(-1, 6), self.seq_center, self.seq_scale),
        ):
            for i in range(data.shape[1]):
                finite = data[:, i][torch.isfinite(data[:, i])]
                if finite.numel():
                    center[i] = finite.mean()
                    scale[i] = finite.std(unbiased=False).clamp_min(0.01)

    def forward(self, stats, sequence):
        stats = ((stats - self.center) / self.scale).nan_to_num().clamp(-5, 5)
        sequence = (
            ((sequence - self.seq_center) / self.seq_scale).nan_to_num().clamp(-5, 5)
        )
        if self.training:
            stats = stats + 0.10 * torch.randn_like(stats)
            sequence = sequence + 0.04 * torch.randn_like(sequence)
        static = self.stats(stats)
        temporal = self.temporal(sequence.transpose(1, 2))
        if self.attention is None:
            pooled = temporal.mean(dim=2)
        else:
            weights = self.attention(temporal).softmax(dim=2)
            pooled = (weights * temporal).sum(dim=2)
        latent = torch.cat((static + self.residual(static), pooled), dim=1)
        return F.normalize(self.fusion(latent), dim=1)

    @torch.inference_mode()
    def embed(self, features):
        stats, seq = tensors(features)
        return self(stats, seq).cpu().numpy()


def tensors(features):
    return (
        torch.from_numpy(np.stack([f.stats for f in features])),
        torch.from_numpy(np.stack([f.sequence for f in features])),
    )


def train(features, labels, epochs=35, initial=None, attention=False):
    torch.manual_seed(42)
    torch.set_num_threads(1)
    model = Encoder(attention)
    if initial:
        model.load_state_dict(
            torch.load(initial, map_location="cpu", weights_only=True), strict=False
        )
    stats, seq = tensors(features)
    model.fit_scaler(stats, seq)
    label_ids = torch.tensor(np.unique(labels, return_inverse=True)[1])
    same = label_ids[:, None] == label_ids[None, :]
    others = ~same
    positive = same & ~torch.eye(len(labels), dtype=torch.bool)
    valid = positive.any(1) & others.any(1)
    if not valid.all():
        raise ValueError(
            "Training needs at least two operators and two sessions per operator"
        )
    opt = torch.optim.AdamW(model.parameters(), lr=0.001)
    for _ in range(epochs):
        vectors = model(stats, seq)
        distances = 1 - vectors @ vectors.T
        hard_pos = distances.masked_fill(~positive, -2).max(1).values
        hard_neg = distances.masked_fill(~others, 3).min(1).values
        loss = F.relu(hard_pos - hard_neg + 0.65).mean()
        opt.zero_grad()
        loss.backward()
        opt.step()
    return model.eval()
