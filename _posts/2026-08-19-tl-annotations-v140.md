---
layout: default
title: "MedVision v1.4.0: 50× More Tumor/Lesion Measurements and Their Annotation Recall"
description: "Dataset v1.4.0 selects tumor and lesion measurements by physical size in millimetres instead of pixel count, growing published measurements from 75,840 to 3,801,540, and quantifies annotation recall by cluster length and by cluster area."
---

<div class="mv-post-head">
  <a class="mv-post-back" href="{{ '/blog.html' | relative_url }}"><i class="fas fa-arrow-left"></i> All posts</a>
  <time class="mv-post-date" datetime="2026-08-19">Aug 19, 2026</time>
</div>

# MedVision v1.4.0: 50× More Tumor/Lesion Measurements and Their Annotation Recall

**Summary.** Dataset `v1.4.0` rebuilds the tumor/lesion (T/L) size annotations of all 12 tumor and lesion collections. Clusters are selected by a physical size floor in millimetres instead of a raw pixel count, a containment test that discarded rotated ellipses is removed, and four guards bracket the ellipse fit. Published measurements increase from **75,840 to 3,801,540 (50×)**. This release also quantifies annotation recall for the first time: of 6,951,667 outlined clusters, 3,801,540 (0.547) carry a measurement, and recall reaches 0.992 for clusters at least 20 mm long.

## Background

Tumor and lesion size is a quantitative clinical endpoint. It informs staging, treatment selection, and response assessment across successive scans. MedVision evaluates whether vision language models can recover that quantity from medical images, which requires a reference standard: a large image corpus in which the physical size of each tumor or lesion is known.

## Measurement procedure

Every volume in these collections carries expert segmentation masks of diseased tissue. On each slice, every connected component of a target-label mask (a *cluster*) is fitted with an ellipse, and the major and minor axis lengths are recorded in millimetres, mirroring how a radiologist sizes a lesion. Those lengths are the reference values against which a model is graded.

Because the fit is automatic, the rules that decide *which clusters are measured* and *which fits are trustworthy* determine the composition of the dataset. v1.4.0 revises those rules.

## Changes in v1.4.0

No measurement published by an earlier version was incorrect. The earlier rules were restrictive in ways that left many measurable lesions out, and the extent of that loss had never been quantified.

**1. Selection in millimetres rather than pixels.** A pixel is not a fixed physical size: it varies between scanners and between viewing directions within one volume. On a case of 0.977/0.977/3.0 mm spacing, the earlier 20 px floor cut at approximately 4.9 mm in the axial plane but 8.6 mm in the sagittal plane, a 3.07× difference in area behind a single number. v1.4.0 measures a cluster when its fitted major axis clears `max(2.0 mm, 2× the coarser in-plane spacing)`, a resolution floor applied identically to every image.

**2. Removal of the orientation-sensitive containment test.** The earlier rule required the fitted ellipse to lie inside a box around the cluster, which tests shape and rotation rather than size: a tilted ellipse protrudes from an axis-aligned box regardless of fit quality. Most of the 50× growth is attributable to this removal rather than to the lower floor.

**3. Four guards on the fit.** Fitting millions of contours automatically admits rare degenerate solutions. v1.4.0 rejects contours under 5 points, non-finite conics, minor axes thinner than one voxel, and major axes exceeding 1.5× the cluster's own bounding-box diagonal. The logged guards rejected 95,800 fits corpus-wide.

## Measurement distribution

<div class="mv-post-fig is-narrow">
  <img src="{{ '/figure/blog/tl-v140-overview-major-axis.svg' | relative_url }}"
       alt="Box plot of major axis distributions for all 38 tumor and lesion types in MedVision v1.4.0">
  <p class="mv-post-figcap">
    Distribution of the major axis for all 3,801,540 measurements. Each row is one of
    the 38 tumor or lesion labels; the box spans the interquartile range and the
    whiskers the central 90%, in millimetres.
  </p>
</div>

The median major axis spans 7.7 mm (non-enhancing brain tumor core, BraTS24-GLI) to 43.3 mm (kidney tumor, KiTS23), so a single expected size does not generalise across diseases. The largest measurement in the corpus, 540.1 mm.

## Annotation recall

Recall is measured clusters divided by all clusters, with the denominator obtained by recounting the expert masks directly rather than by reading the annotation plan. Across the 12 collections the masks contain **6,951,667** clusters, of which **3,801,540 (0.547)** carry a measurement.

The unmeasured remainder is dominated by fragments: **95.5% of unmeasured clusters are ≤10 px and 84.7% are ≤5 px, and clusters of 1–2 px**, over a quarter of the corpus, cannot yield the 5-point contour that a fit requires. The corpus value of 0.547 therefore counts components, not clinically measurable lesions. The two stratifications below separate the two quantities; each partitions the same 6,951,667 clusters and reproduces the same margins.

### Recall by major axis length

Length is the maximum Feret diameter of a cluster in millimetres, the mask-side proxy for the fitted major axis on which the selection rule acts. Each in-plane axis is scaled by its own spacing, since 43.8% of slices are anisotropic in-plane.

| Cluster length | Clusters | Measured | Recall | Cumulative recall |
| --- | ---: | ---: | ---: | ---: |
| ≤2 mm | 2,232,427 | 1,952 | 0.001 | 0.547 |
| 2–5 mm | 974,881 | 409,412 | 0.420 | 0.805 |
| 5–10 mm | 955,724 | 694,683 | 0.727 | 0.905 |
| 10–20 mm | 1,055,235 | 976,105 | 0.925 | 0.967 |
| 20–50 mm | 1,263,241 | 1,250,268 | 0.990 | 0.992 |
| 50–100 mm | 413,816 | 412,849 | 0.998 | 0.998 |
| >100 mm | 56,343 | 56,271 | 0.999 | 0.999 |
| **All** | **6,951,667** | **3,801,540** | **0.547** | |

The fourth column is the recall of each bin in isolation; the fifth pools every cluster at or above that bin, which is the quantity a user of the dataset sees when selecting lesions above a size threshold. Pooled that way, **recall is 0.967 for clusters ≥10 mm and 0.992 for clusters ≥20 mm**, and at ≥20 mm no collection falls below 0.972 (PI-CAI, the minimum).

The gradient between 2 and 20 mm reflects the resolution-adjusted floor rather than a loss of measurable disease: the 2 mm term binds only on sub-millimetre grids, whereas a reformat of 3 mm spacing retains nothing under 6 mm. The 1,952 measured clusters in the ≤2 mm bin are not an exception to the floor: the bin variable is the Feret proxy, which understates the fitted major axis by roughly one pixel.

### Recall by cluster area

Area is the physical area of the cluster on its slice in mm², derived from the same recount.

| Cluster area | Clusters | Measured | Recall | Cumulative recall |
| --- | ---: | ---: | ---: | ---: |
| ≤2 mm² | 1,684,011 | 64 | 0.000 | 0.547 |
| 2–5 mm² | 696,041 | 40,093 | 0.058 | 0.722 |
| 5–10 mm² | 526,878 | 237,702 | 0.451 | 0.823 |
| 10–20 mm² | 545,631 | 371,569 | 0.681 | 0.871 |
| 20–50 mm² | 725,574 | 530,074 | 0.731 | 0.901 |
| 50–100 mm² | 582,689 | 467,469 | 0.802 | 0.945 |
| 100–500 mm² | 1,347,005 | 1,311,216 | 0.973 | 0.983 |
| 500–1000 mm² | 428,510 | 428,120 | 0.999 | 0.999 |
| >1000 mm² | 415,328 | 415,233 | 1.000 | 1.000 |
| **All** | **6,951,667** | **3,801,540** | **0.547** | |

Pooled upward as before, **recall reaches 0.983 for clusters ≥100 mm² and 0.999 for clusters ≥500 mm²**, where the lowest collection is 0.999 (MSD). Saturation is more gradual than for length, and one collection remains below 0.97 at ≥100 mm² (autoPET-III, 0.948). Area does not determine the major axis: at a fixed area an elongated cluster has a longer major axis than a compact one and is more likely to clear the floor, while the thinnest clusters are removed by the sub-voxel minor-axis guard. Length, the variable the rule acts on, is therefore the sharper predictor of recall, and the area view describes the same corpus with shapes mixed together.

<div class="mv-post-fig">
  <img src="{{ '/figure/blog/tl-v140-overview-recall.svg' | relative_url }}"
       alt="Recall of tumor and lesion measurements against cluster area and cluster length, one curve per collection, MedVision v1.4.0">
  <p class="mv-post-figcap">
    Recall against cluster area (left) and cluster length (right), one curve per
    collection. Both panels stratify the same 6,951,667 clusters. Recall rises with
    size in every collection and is at least 0.972 for clusters ≥20 mm long.
  </p>
</div>

## Implications for users

The images are unchanged; only the T/L measurements were rebuilt. They are larger in number, selected consistently across scans and viewing directions, and free of degenerate values. Every earlier annotation version (`<1.4.0`) remains published unchanged, so previous results stay reproducible.

One caveat applies to comparisons. Case counts per split are unchanged, but train/test membership changes for six collections (autoPET-III, BraTS24, HNTSMRG24, KiPA22, KiTS23, MSD), whose earlier splits had been force-aligned to `v1.0.0`. A v1.4.0 test metric should not be compared against a pre-1.4.0 one on those six.

The [full release note](https://huggingface.co/datasets/YongchengYAO/MedVision/blob/main/doc/release-v1.4.0.md){:target="_blank" rel="noopener"} documents every rule, number, and verification behind this post.
