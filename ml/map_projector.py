"""Stable out-of-sample projection and frozen density cluster assignments."""

import numpy as np
from functools import cached_property

from sklearn.cluster import HDBSCAN
from sklearn.decomposition import PCA
from umap import UMAP


class MapProjector:
    def __init__(self, vectors):
        self.reference = vectors
        self.model = UMAP(
            n_components=2,
            n_neighbors=min(10, len(vectors) - 1),
            metric="cosine",
            random_state=42,
            transform_seed=42,
            init="random",
            n_jobs=1,
        )
        self.coordinates = self.model.fit_transform(vectors)
        self.clusters = HDBSCAN(
            min_cluster_size=max(2, min(4, len(vectors) // 4))
        ).fit_predict(self.coordinates)

    def point(self, vector):
        scores = self.reference @ vector
        nearest = int(np.argmax(scores))
        if scores[nearest] >= 0.999999:
            xy = self.coordinates[nearest]
        else:
            xy = self.model.transform(vector[None, :])[0]
        cluster = int(self.clusters[nearest]) if scores[nearest] >= 0.80 else -1
        return {"x": float(xy[0]), "y": float(xy[1]), "cluster_id": cluster}

    @cached_property
    def space(self):
        # Fit against the generation's fixed training vectors, including for
        # projector artifacts created before the 3D population view existed.
        return PCA(n_components=3, svd_solver="full").fit(self.reference)

    def position_3d(self, vector):
        return self.space.transform(np.asarray(vector).reshape(1, -1))[0].tolist()
