"""Smooth only display cutouts; exact source partitions remain available."""
import cv2
import json
import numpy as np
from scipy import ndimage as ndi
from PIL import Image

EDGE_VERSION = 1


def smooth_cutout(rgb, alpha, labels, layer_id):
    inside = (labels == layer_id).astype(np.uint8)
    if not inside.any():
        return np.zeros((*alpha.shape,4),np.uint8)
    # Replicate padding preserves art cut off at the canvas edge.
    padded = np.pad(inside, 6, mode='edge')
    inner = cv2.distanceTransform(padded, cv2.DIST_L2, cv2.DIST_MASK_PRECISE)
    outer = cv2.distanceTransform(1-padded, cv2.DIST_L2, cv2.DIST_MASK_PRECISE)
    signed = inner-outer
    sigma = np.clip(max(alpha.shape)/800, .8, 1.8)
    fair = cv2.GaussianBlur(signed, (0,0), float(sigma))[6:-6,6:-6]
    # Subpixel coverage with slight overlap at shared cuts. RGB stays untouched
    # wherever coverage is visible, so overlap cannot introduce a foreign colour.
    coverage = np.clip(.5 + (fair+.42)/1.15, 0, 1)
    coverage = coverage*coverage*(3-2*coverage)
    # Keep narrow strands and small details instead of erasing them by erosion.
    nearby_thickness=ndi.maximum_filter(inner,size=5)[6:-6,6:-6]
    thin = (inside>0)&(nearby_thickness<=1.5)
    coverage[thin] = np.maximum(coverage[thin], .72)
    mask = np.round(coverage*alpha).astype(np.uint8)
    colors = rgb.copy()
    # RGB under fully transparent pixels must match the nearest edge, otherwise
    # GPU bilinear/mipmap sampling mixes white background into dark cut edges.
    solid = mask>=64
    if solid.any():
        nearest = ndi.distance_transform_edt(~solid,return_distances=False,return_indices=True)
        transparent=mask==0
        colors[transparent]=rgb[tuple(nearest[:,transparent])]
    return np.dstack([colors,mask])


def save_smooth_layer(folder,rgb,alpha,labels,layer_id):
    filename=f'layer-{layer_id}-smooth.png'
    Image.fromarray(smooth_cutout(rgb,alpha,labels,layer_id)).save(folder/filename)
    return filename


def save_contours(folder,filename,layer_id):
    alpha=np.asarray(Image.open(folder/filename).convert('RGBA'))[:,:,3]
    contours,_=cv2.findContours((alpha>=128).astype(np.uint8),cv2.RETR_LIST,cv2.CHAIN_APPROX_SIMPLE)
    loops=[]
    for contour in contours:
        if len(contour)<3 or abs(cv2.contourArea(contour))<2:continue
        contour=cv2.approxPolyDP(contour,.55,True)
        if len(contour)>=3:loops.append(contour[:,0,:].tolist())
    output=f'layer-{layer_id}-contours.json'
    (folder/output).write_text(json.dumps({'width':alpha.shape[1],'height':alpha.shape[0],'loops':loops},separators=(',',':')),encoding='utf-8')
    return output


def refresh_display_edges(folder,metadata):
    if metadata.get('segmentation')=='psd':
        return metadata
    rgb=np.asarray(Image.open(folder/'source.png').convert('RGB'))
    alpha=np.asarray(Image.open(folder/'alpha.png').convert('L'))
    labels=np.asarray(Image.open(folder/'labels.png').convert('L'))
    for layer in metadata['layers']:
        layer['render_file']=save_smooth_layer(folder,rgb,alpha,labels,layer['id'])
        layer['contour_file']=save_contours(folder,layer['render_file'],layer['id'])
    metadata['edge_processing']={'version':EDGE_VERSION,'method':'signed-distance-fairing-antialias','source_masks_preserved':True}
    return metadata
